//! WordMate-specific fragment assistance. All socket/disk work is off the IMK thread.
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, Instant, SystemTime};

fn backend_dir() -> PathBuf {
    std::env::var_os("WM_USER_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/WordMate")
        })
}
fn write_frame(stream: &mut UnixStream, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|_| "ENCODE")?;
    if body.len() > 65536 {
        return Err("FRAME_SIZE".into());
    }
    stream
        .write_all(&(body.len() as u32).to_le_bytes())
        .map_err(|_| "WRITE")?;
    stream
        .write_all(&body)
        .map_err(|_| "WRITE")
        .map_err(str::to_owned)
}
fn read_bytes(
    stream: &mut UnixStream,
    bytes: &mut [u8],
    cancel: Option<(&AtomicU64, u64)>,
    deadline: Instant,
) -> Result<(), String> {
    let mut offset = 0;
    while offset < bytes.len() {
        if cancel.is_some_and(|(current, expected)| current.load(Ordering::Acquire) != expected) {
            return Err("CANCELED".into());
        }
        if Instant::now() >= deadline {
            return Err("TIMEOUT".into());
        }
        match stream.read(&mut bytes[offset..]) {
            Ok(0) => return Err("CLOSED".into()),
            Ok(size) => offset += size,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) => {}
            Err(_) => return Err("READ".into()),
        }
    }
    Ok(())
}
fn read_frame(
    stream: &mut UnixStream,
    cancel: Option<(&AtomicU64, u64)>,
    deadline: Instant,
) -> Result<Value, String> {
    let mut header = [0; 4];
    read_bytes(stream, &mut header, cancel, deadline)?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0 || size > 65536 {
        return Err("FRAME_SIZE".into());
    }
    let mut data = vec![0; size];
    read_bytes(stream, &mut data, cancel, deadline)?;
    let response: Value = serde_json::from_slice(&data).map_err(|_| "FORMAT")?;
    if response["ok"] == true {
        Ok(response["result"].clone())
    } else {
        Err(response["error"]["code"]
            .as_str()
            .unwrap_or("SERVICE_UNAVAILABLE")
            .to_owned())
    }
}
fn launch_backend() {
    let dir = backend_dir();
    let configured = std::fs::read(dir.join("browser-host/connection.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["appPath"].as_str().map(PathBuf::from));
    let candidates = configured.into_iter().chain([
        PathBuf::from("/Applications/WordMate.app"),
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join("Applications/WordMate.app"),
    ]);
    if let Some(path) = candidates
        .filter(|p| p.is_absolute())
        .find(|p| p.join("Contents/Info.plist").is_file())
    {
        let _ = std::process::Command::new("/usr/bin/open")
            .args(["-g", "-a"])
            .arg(path)
            .args(["--args", "--ime-background"])
            .status();
    }
}
pub fn rpc(method: &str, payload: Value) -> Result<Value, String> {
    rpc_cancellable(method, payload, None)
}
fn rpc_cancellable(
    method: &str,
    payload: Value,
    cancel: Option<(&AtomicU64, u64)>,
) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let dir = backend_dir();
    let path = dir.join("ime.sock");
    let mut stream = match UnixStream::connect(&path) {
        Ok(s) => s,
        Err(_) => {
            launch_backend();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if let Ok(s) = UnixStream::connect(&path) {
                    break s;
                }
                if Instant::now() >= deadline {
                    return Err("SERVICE_UNAVAILABLE".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| "TIMEOUT")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "TIMEOUT")?;
    let token = std::fs::read_to_string(dir.join("ime-token")).map_err(|_| "UNAUTHORIZED")?;
    write_frame(
        &mut stream,
        &json!({"protocolVersion":1,"requestId":"hello","method":"hello","payload":{"authToken":token.trim()}}),
    )?;
    read_frame(&mut stream, cancel, deadline)?;
    write_frame(
        &mut stream,
        &json!({"protocolVersion":1,"requestId":uuid::Uuid::new_v4().to_string(),"method":method,"payload":payload}),
    )?;
    read_frame(&mut stream, cancel, deadline)
}

#[derive(Clone)]
struct Preview {
    generation: u64,
    source: String,
    target: String,
    context: String,
    epoch: String,
    selection: bool,
}
struct Reply {
    generation: u64,
    result: Result<Value, String>,
    preferences: Option<Value>,
}
#[derive(Clone)]
pub struct DraftWord {
    pub candidate: qingjian_core::Candidate,
    pub keys: String,
    pub text: String,
}

pub struct Assistant {
    pub generation: u64,
    pub draft: Vec<DraftWord>,
    pub committing: bool,
    pub fallback: Option<String>,
    epoch: String,
    source: String,
    pub target: String,
    pub text: Option<String>,
    pub meaning: String,
    pub status: String,
    pub context: String,
    pub enabled: bool,
    pub save_context: bool,
    preferences_revision: u64,
    notices: Receiver<String>,
    current: Arc<AtomicU64>,
    tx: Sender<Preview>,
    rx: Receiver<Reply>,
    learning_tx: Sender<Value>,
}
impl Assistant {
    pub fn new() -> Self {
        let (tx, work) = mpsc::channel::<Preview>();
        let (done, rx) = mpsc::channel();
        let current = Arc::new(AtomicU64::new(0));
        let worker_current = current.clone();
        std::thread::spawn(move || {
            while let Ok(mut request) = work.recv() {
                // Coalesce every keystroke; network is never called on the IMK thread.
                while let Ok(next) = work.recv_timeout(Duration::from_millis(300)) {
                    request = next;
                }
                if worker_current.load(Ordering::Acquire) != request.generation {
                    continue;
                }
                let preferences = rpc("preferences.get", json!({})).ok();
                if worker_current.load(Ordering::Acquire) != request.generation {
                    continue;
                }
                let result = if preferences.as_ref().is_some_and(|p| p["enabled"] == true) {
                    let revision = preferences
                        .as_ref()
                        .and_then(|p| p["revision"].as_u64())
                        .unwrap_or(0);
                    rpc_cancellable(
                        if request.selection {
                            "preview.selection"
                        } else {
                            "preview.fragment"
                        },
                        json!({
                            "identity":{"sessionId":request.epoch,"clientGeneration":request.generation,"fragmentId":"active","revision":request.generation,"settingsRevision":revision},
                            "sourceText":request.source,"sourceCandidateId":"highlighted","target":request.target,
                            "contextBefore":request.context,"contextAfter":""
                        }),
                        Some((&worker_current, request.generation)),
                    )
                } else {
                    Err("NOT_CONFIGURED".into())
                };
                let result = if preferences.as_ref().is_some_and(|before| {
                    rpc("preferences.get", json!({}))
                        .ok()
                        .is_some_and(|after| after["revision"] != before["revision"])
                }) {
                    Err("SETTINGS_CHANGED".into())
                } else {
                    result
                };
                if done
                    .send(Reply {
                        generation: request.generation,
                        result,
                        preferences,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let (learning_tx, notices) = learning_worker();
        Self {
            generation: 0,
            draft: Vec::new(),
            committing: false,
            fallback: None,
            epoch: uuid::Uuid::new_v4().to_string(),
            source: String::new(),
            target: "en".into(),
            text: None,
            meaning: String::new(),
            status: String::new(),
            context: String::new(),
            enabled: false,
            save_context: false,
            preferences_revision: 0,
            current,
            tx,
            rx,
            learning_tx,
            notices,
        }
    }
    pub fn invalidate(&mut self, clear_context: bool) {
        self.generation += 1;
        self.current.store(self.generation, Ordering::Release);
        self.source.clear();
        self.text = None;
        self.status.clear();
        self.committing = false;
        self.fallback = None;
        if clear_context {
            self.fallback = None;
            self.context.clear();
            self.epoch = uuid::Uuid::new_v4().to_string();
        }
    }
    pub fn observe(&mut self, source: &str, local: Option<&str>, selection: bool) {
        self.invalidate(false);
        self.source = source.to_owned();
        self.meaning = source.to_owned();
        if source.is_empty() {
            return;
        }
        self.target = if source
            .chars()
            .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
        {
            "en"
        } else {
            "zh"
        }
        .into();
        self.text = local.filter(|s| !s.is_empty()).map(str::to_owned);
        self.status = if self.text.is_some() {
            "本地译词"
        } else {
            "辅助准备中…"
        }
        .into();
        if self
            .tx
            .send(Preview {
                generation: self.generation,
                source: source.into(),
                target: self.target.clone(),
                context: self.context.clone(),
                epoch: self.epoch.clone(),
                selection,
            })
            .is_err()
        {
            self.status = "辅助不可用；普通输入可用".into();
        }
    }
    pub fn poll(&mut self) -> bool {
        let mut changed = false;
        while let Ok(reply) = self.rx.try_recv() {
            if reply.generation != self.generation {
                continue;
            }
            changed = true;
            if let Some(p) = reply.preferences {
                self.enabled = p["enabled"] == true;
                self.save_context = p["saveContext"] == true;
                self.preferences_revision = p["revision"].as_u64().unwrap_or(0);
            }
            match reply.result {
                Ok(value) => {
                    if let Some(text) = value["candidates"][0]["text"].as_str() {
                        self.text = Some(text.into());
                        self.meaning = value["candidates"][0]["meaning"]
                            .as_str()
                            .unwrap_or(&self.source)
                            .into();
                        self.status = "语境译词".into();
                    }
                }
                Err(code) => {
                    self.status = if self.text.is_some() {
                        "本地译词；云辅助未就绪"
                    } else if code == "NOT_CONFIGURED" {
                        "在 WordMate 设置开启云辅助"
                    } else {
                        "辅助暂不可用；普通输入可用"
                    }
                    .into()
                }
            }
        }
        changed
    }
    pub fn take_notice(&self) -> Option<String> {
        self.notices.try_recv().ok()
    }
    pub fn draft_text(&self) -> String {
        self.draft.iter().map(|word| word.text.as_str()).collect()
    }
    pub fn has_draft(&self) -> bool {
        !self.draft.is_empty()
    }
    pub fn source(&self) -> &str {
        &self.source
    }
    pub fn note_text(&mut self, text: &str) {
        self.context.push_str(text);
        self.context = self
            .context
            .chars()
            .rev()
            .take(120)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
    pub fn learn(&self, text: &str, meaning: &str, origin: &str) {
        if !text.chars().any(|c| c.is_ascii_alphabetic())
            || text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
        {
            return;
        }
        let _ = self.learning_tx.send(
            json!({"commitId":uuid::Uuid::new_v4().to_string(),"confirmed":true,
            "adoptedExpression":text.trim(),"sourceMeaning":meaning,"origin":origin,
            "context":if self.save_context {self.context.clone()} else {String::new()}}),
        );
    }
}
fn learning_worker() -> (Sender<Value>, Receiver<String>) {
    let (notice, notices) = mpsc::channel::<String>();
    let (tx, rx) = mpsc::channel::<Value>();
    std::thread::spawn(move || {
        let directory = backend_dir().join("ime-outbox");
        let _ = std::fs::create_dir_all(&directory);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700));
        }
        loop {
            if let Ok(event) = rx.recv_timeout(Duration::from_secs(5)) {
                let count = std::fs::read_dir(&directory)
                    .map(|i| i.count())
                    .unwrap_or(100);
                if count < 100 {
                    if let Some(id) = event["commitId"].as_str() {
                        let path = directory.join(format!("{id}.json"));
                        let data = serde_json::to_vec(&event).unwrap_or_default();
                        if qingjian_core::storage::write_atomic_private(&path, |writer| {
                            writer.write_all(&data)
                        })
                        .is_err()
                        {
                            let _ =
                                notice.send("英文已上屏，但学习记录未保存，请手动加入词本".into());
                        }
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let _ = std::fs::set_permissions(
                                &path,
                                std::fs::Permissions::from_mode(0o600),
                            );
                        }
                    }
                } else {
                    let _ = notice.send("英文已上屏，待保存队列已满，请手动加入词本".into());
                }
            }
            let Ok(files) = std::fs::read_dir(&directory) else {
                continue;
            };
            for file in files.flatten().take(100) {
                let path = file.path();
                if file
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| SystemTime::now().duration_since(t).ok())
                    .is_some_and(|d| d.as_secs() > 7 * 86400)
                {
                    let _ = std::fs::remove_file(path);
                    continue;
                }
                let Ok(data) = std::fs::read(&path) else {
                    continue;
                };
                let Ok(event) = serde_json::from_slice::<Value>(&data) else {
                    continue;
                };
                match rpc("learning.commit", event) {
                    Ok(_) => {
                        let _ = std::fs::remove_file(path);
                    }
                    Err(code) if code == "INVALID_INPUT" => {
                        let _ = std::fs::remove_file(path);
                    }
                    Err(_) => break,
                }
            }
        }
    });
    (tx, notices)
}

#[cfg(test)]
mod tests {
    #[test]
    fn context_has_character_limit() {
        let text = "中文❤️".repeat(100);
        let context: String = text
            .chars()
            .rev()
            .take(120)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        assert_eq!(context.chars().count(), 120);
    }
}

/// Existing optional prediction uses the same WordMate model, never a second API key.
pub struct BridgePredictor {
    tx: Sender<qingjian_core::PredictionRequest>,
    rx: Receiver<qingjian_core::Prediction>,
    slots: usize,
}
impl BridgePredictor {
    pub fn new(slots: usize) -> Self {
        let (tx, work) = mpsc::channel::<qingjian_core::PredictionRequest>();
        let (done, rx) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok(mut r) = work.recv() {
                while let Ok(next) = work.recv_timeout(Duration::from_millis(300)) {
                    r = next;
                }
                let kind = match r.kind {
                    qingjian_core::PredictionKind::Compose => "compose",
                    qingjian_core::PredictionKind::Question => "question",
                    qingjian_core::PredictionKind::Translate => "translate",
                };
                let value = rpc(
                    "prediction.query",
                    json!({"kind":kind,"before":r.before,"after":r.after,"pinyin":r.pinyin,"candidates":r.candidates,"guess":r.guess,"text":r.text,"target":r.target_language,"maxItems":r.max_items.min(8),"wantSentence":r.want_sentence}),
                );
                let prediction = match value {
                    Ok(v) => qingjian_core::Prediction {
                        sequence: r.sequence,
                        words: v["words"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|w| {
                                Some(qingjian_core::CloudWord {
                                    text: w["text"].as_str()?.into(),
                                    syllables: w["syllables"]
                                        .as_array()
                                        .into_iter()
                                        .flatten()
                                        .filter_map(|s| s.as_str().map(str::to_owned))
                                        .collect(),
                                    reading: None,
                                })
                            })
                            .take(8)
                            .collect(),
                        sentence: v["sentence"].as_str().map(str::to_owned),
                    },
                    Err(_) => qingjian_core::Prediction {
                        sequence: r.sequence,
                        ..Default::default()
                    },
                };
                if done.send(prediction).is_err() {
                    break;
                }
            }
        });
        Self { tx, rx, slots }
    }
}
impl qingjian_core::Predictor for BridgePredictor {
    fn policy(&self) -> qingjian_core::PredictionPolicy {
        qingjian_core::PredictionPolicy {
            slots: self.slots,
            ..Default::default()
        }
    }
    fn submit(&mut self, request: qingjian_core::PredictionRequest) {
        let _ = self.tx.send(request);
    }
    fn poll(&mut self) -> Option<qingjian_core::Prediction> {
        self.rx.try_recv().ok()
    }
}
