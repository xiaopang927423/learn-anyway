//! WordMate online dictionary manager. Qingjian's public data protocol; no input text is sent.
mod catalog;
mod fetch;
pub use catalog::Entry;
use qingjian_dictionary::Dictionary;
use std::{
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, Sender},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;
const DAY: u64 = 24 * 60 * 60;

enum Event {
    Catalog(Vec<Entry>),
    Progress(String),
    Installed(String),
    Done(Result<String, String>),
}

pub struct Manager {
    root: PathBuf,
    pub entries: Vec<Entry>,
    pub status: String,
    pub busy: bool,
    receiver: Option<Receiver<Event>>,
    next_check: u64,
}
impl Manager {
    pub fn new(root: PathBuf) -> Self {
        let cached = std::fs::read(root.join("catalog.json"))
            .ok()
            .and_then(|b| catalog::parse(&b).ok());
        let last = std::fs::read_to_string(root.join("checked-at"))
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        Self {
            entries: cached.unwrap_or_else(|| {
                catalog::parse(include_bytes!("catalog.json")).expect("bundled catalogue")
            }),
            status: if last == 0 {
                "尚未联网检查；可直接下载，离线时使用已有词库".into()
            } else {
                "已加载缓存清单，可检查是否有新版本".into()
            },
            root,
            busy: false,
            receiver: None,
            next_check: last.saturating_add(DAY).min(now() + DAY),
        }
    }
    pub fn poll(&mut self) -> (bool, Vec<String>) {
        let mut changed = false;
        let mut installed = Vec::new();
        if let Some(rx) = &self.receiver {
            loop {
                match rx.try_recv() {
                    Ok(event) => {
                        changed = true;
                        match event {
                            Event::Catalog(entries) => {
                                self.entries = entries;
                                self.next_check = now() + DAY;
                            }
                            Event::Progress(s) => self.status = s,
                            Event::Installed(id) => installed.push(id),
                            Event::Done(result) => {
                                self.busy = false;
                                if result.is_err() {
                                    self.next_check = now() + 3600;
                                }
                                self.status = result
                                    .unwrap_or_else(|e| format!("{e}；已有词库仍可使用，可重试"));
                            }
                        }
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        if self.busy {
                            self.busy = false;
                            changed = true;
                            self.status = "下载任务中断，已有词库保持，请重试".into();
                        }
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                }
            }
        }
        if !self.busy {
            self.receiver = None;
        }
        (changed, installed)
    }
    pub fn auto_check(&mut self, enabled: Vec<String>) {
        if !self.busy && now() >= self.next_check {
            self.check(enabled);
        }
    }
    /// Empty `enabled` means check only. With entries, update enabled domains/subscriptions as well.
    pub fn check(&mut self, enabled: Vec<String>) {
        if self.busy {
            return;
        }
        self.next_check = now() + 3600; // Offline failures retry at most once per hour this run.
        let root = self.root.clone();
        self.start("正在检查词库更新…", move |tx| {
            let runtime = fetch::runtime()?;
            let client = fetch::client()?;
            runtime.block_on(async {
                let (entries, bytes) = fetch::index(&client).await?;
                std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
                atomic_write(&root.join("catalog.json"), &bytes)?;
                atomic_write(&root.join("checked-at"), now().to_string().as_bytes())?;
                let _ = tx.send(Event::Catalog(entries.clone()));
                let mut updated = 0;
                let mut failures = Vec::new();
                for entry in entries
                    .iter()
                    .filter(|e| enabled.contains(&e.stem()) && e.compatible())
                {
                    if !needs_update(entry, &root) {
                        continue;
                    }
                    match run_download(&client, entry, &root, &tx).await {
                        Ok(()) => updated += 1,
                        Err(e) => failures.push(format!("{}：{e}", entry.name)),
                    }
                }
                if failures.is_empty() {
                    Ok(format!("检查完成，已更新 {updated} 本词库"))
                } else {
                    Err(format!("已更新 {updated} 本；{}", failures.join("；")))
                }
            })
        });
    }
    pub fn download(&mut self, id: &str) {
        if self.busy {
            return;
        }
        let Some(entry) = self.entries.iter().find(|e| e.id == id).cloned() else {
            return;
        };
        let root = self.root.clone();
        self.start("正在连接词库服务器…", move |tx| {
            fetch::runtime()?.block_on(run_download(&fetch::client()?, &entry, &root, &tx))?;
            Ok(format!(
                "{} {} 已安装；下次输入生效",
                entry.name, entry.version
            ))
        });
    }
    fn start(
        &mut self,
        status: &str,
        run: impl FnOnce(Sender<Event>) -> Result<String, String> + Send + 'static,
    ) {
        let root = self.root.clone();
        let (tx, rx) = mpsc::channel();
        self.busy = true;
        self.status = status.into();
        self.receiver = Some(rx);
        if let Err(e) = std::thread::Builder::new()
            .name("wordmate-dictionaries".into())
            .spawn(move || {
                let result = (|| {
                    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
                    let lock = std::fs::OpenOptions::new()
                        .create(true)
                        .truncate(false)
                        .read(true)
                        .write(true)
                        .open(root.join("update.lock"))
                        .map_err(|e| e.to_string())?;
                    lock.try_lock()
                        .map_err(|_| "另一个 WordMate 进程正在更新词库，请稍后重试".to_owned())?;
                    run(tx.clone())
                })();
                let _ = tx.send(Event::Done(result));
            })
        {
            self.busy = false;
            self.status = format!("无法启动下载：{e}");
        }
    }
}

async fn run_download(
    client: &reqwest::Client,
    entry: &Entry,
    root: &Path,
    tx: &Sender<Event>,
) -> Result<(), String> {
    let percent = std::cell::Cell::new(101);
    fetch::download(client, entry, root, |done, total| {
        let n = done.saturating_mul(100) / total.max(1);
        if percent.replace(n) != n {
            let _ = tx.send(Event::Progress(format!("{}：下载 {n}%", entry.name)));
        }
    })
    .await?;
    let _ = tx.send(Event::Installed(entry.id.clone()));
    Ok(())
}

pub fn installed_version(root: &Path, stem: &str) -> Option<String> {
    let dictionary = Dictionary::from_path(root.join(format!("{stem}.qj"))).ok()?;
    (!dictionary.is_empty())
        .then(|| dictionary.metadata().map(|m| m.version.clone()))
        .flatten()
}
pub fn needs_update(entry: &Entry, root: &Path) -> bool {
    let Some(installed) =
        installed_version(root, &entry.stem()).and_then(|v| crate::Version::parse(&v))
    else {
        return true;
    };
    crate::Version::parse(&entry.version).is_some_and(|remote| remote > installed)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("pending");
    std::fs::write(&temp, bytes)
        .and_then(|()| std::fs::rename(&temp, path))
        .map_err(|e| e.to_string())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
