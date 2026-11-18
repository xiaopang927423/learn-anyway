//! Public data only. Fixed HTTPS origins, bounded streams, hashes, validation, atomic replacement.
use super::{Entry, MAX_DOWNLOAD, catalog};
use qingjian_dictionary::Dictionary;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    time::Duration,
};

pub(super) const INDEX_HOSTS: [&str; 2] = [
    "https://raw.githubusercontent.com/qingjian-team/qingjian-dicts/main",
    "https://gitee.com/qingjian-team/qingjian-dicts/raw/main",
];
const RELEASE_HOSTS: [&str; 2] = [
    "https://github.com/qingjian-team/qingjian-dicts/releases/download",
    "https://gitee.com/qingjian-team/qingjian-dicts/releases/download",
];
const MAX_SMALL: u64 = 512 * 1024;
const MAX_UNPACKED: u64 = 256 * 1024 * 1024;

pub(super) fn runtime() -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
}
pub(super) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .user_agent("WordMate-Dictionaries/1")
        .build()
        .map_err(|e| e.to_string())
}

pub(super) async fn get(
    client: &reqwest::Client,
    url: &str,
    limit: u64,
    progress: impl Fn(u64),
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(describe)?;
    if response.content_length().is_some_and(|n| n > limit) {
        return Err("下载大小超过限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(describe)? {
        if bytes.len() as u64 + chunk.len() as u64 > limit {
            return Err("下载大小超过限制".into());
        }
        bytes.extend_from_slice(&chunk);
        progress(bytes.len() as u64);
    }
    Ok(bytes)
}

pub(super) async fn index(client: &reqwest::Client) -> Result<(Vec<Entry>, Vec<u8>), String> {
    let mut jobs = tokio::task::JoinSet::new();
    for host in INDEX_HOSTS {
        let client = client.clone();
        jobs.spawn(async move {
            let bytes = get(&client, &format!("{host}/index.json"), MAX_SMALL, |_| {}).await?;
            catalog::parse(&bytes).map(|entries| (entries, bytes))
        });
    }
    let mut error = "无法连接词库服务器".to_owned();
    while let Some(result) = jobs.join_next().await {
        match result {
            Ok(Ok(value)) => return Ok(value),
            Ok(Err(e)) => error = e,
            Err(e) => error = e.to_string(),
        }
    }
    Err(error)
}

#[derive(Deserialize)]
struct Piece {
    bytes: u64,
    sha256: String,
}
#[derive(Deserialize)]
struct Part {
    name: String,
    bytes: u64,
    sha256: String,
}
#[derive(Deserialize)]
struct Manifest {
    dict: String,
    version: String,
    tag: String,
    qj_format: u16,
    archive: Piece,
    parts: Vec<Part>,
}

fn manifest(bytes: &[u8], entry: &Entry) -> Result<Manifest, String> {
    let m: Manifest = serde_json::from_slice(bytes).map_err(|_| "下载清单无效")?;
    if m.dict != entry.id
        || m.version != entry.version
        || m.tag != entry.tag
        || m.qj_format != 1
        || m.archive.bytes != entry.bytes
        || m.archive.bytes > MAX_DOWNLOAD
        || m.parts.is_empty()
        || m.parts.len() > 32
        || !valid_hash(&m.archive.sha256)
        || m.parts.iter().any(|p| {
            !catalog::safe_name(&p.name)
                || p.bytes == 0
                || p.bytes > MAX_DOWNLOAD
                || !valid_hash(&p.sha256)
        })
        || m.parts.iter().map(|p| p.bytes).sum::<u64>() != m.archive.bytes
    {
        return Err("下载清单与词库版本或大小不匹配".into());
    }
    Ok(m)
}

pub(super) async fn download(
    client: &reqwest::Client,
    entry: &Entry,
    root: &Path,
    progress: impl Fn(u64, u64),
) -> Result<(), String> {
    if !entry.compatible() {
        return Err("请先升级输入法以支持此词库格式".into());
    }
    // Try each official mirror, including when the first one serves a damaged file.
    let mut last = "无法连接词库服务器".to_owned();
    for host in RELEASE_HOSTS {
        let result = async {
            let base = format!("{host}/{}", entry.tag);
            let bytes = get(client, &format!("{base}/manifest.json"), MAX_SMALL, |_| {}).await?;
            let m = manifest(&bytes, entry)?;
            let mut archive = Vec::new();
            for part in &m.parts {
                let before = archive.len() as u64;
                let bytes = get(client, &format!("{base}/{}", part.name), part.bytes, |n| {
                    progress(before + n, m.archive.bytes)
                })
                .await?;
                check(&bytes, part.bytes, &part.sha256)?;
                archive.extend_from_slice(&bytes);
            }
            check(&archive, m.archive.bytes, &m.archive.sha256)?;
            install(entry, &archive, root)
        }
        .await;
        match result {
            Ok(()) => return Ok(()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn check(bytes: &[u8], size: u64, expected: &str) -> Result<(), String> {
    if bytes.len() as u64 != size || hash(bytes) != expected {
        return Err("词库校验失败，保留原有版本".into());
    }
    Ok(())
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(super) fn install(entry: &Entry, archive: &[u8], root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let target = root.join(format!("{}.qj", entry.stem()));
    let unpacked = root.join(format!(".{}.unpacked", entry.stem()));
    let pending = root.join(format!(".{}.pending", entry.stem()));
    let result = (|| {
        let decoder = flate2::read::GzDecoder::new(archive);
        let mut file = File::create(&unpacked).map_err(|e| e.to_string())?;
        let len = std::io::copy(&mut decoder.take(MAX_UNPACKED + 1), &mut file)
            .map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        if len > MAX_UNPACKED {
            return Err("解压后词库超过大小限制".into());
        }
        let dictionary =
            Dictionary::from_path(&unpacked).map_err(|e| format!("词库内容无效：{e}"))?;
        if dictionary.is_empty() {
            return Err("词库没有可用词条".into());
        }
        let mut metadata = dictionary.metadata().cloned().ok_or("缺少词库来源信息")?;
        // Keep attribution/source/license. The catalogue version is saved in the same atomic file.
        metadata.version = entry.version.clone();
        dictionary
            .write_qj(&pending, &metadata)
            .map_err(|e| e.to_string())?;
        File::open(&pending)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&pending, &target).map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = std::fs::remove_file(unpacked);
    let _ = std::fs::remove_file(pending);
    result
}

fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "连接词库服务器超时，请稍后重试".into()
    } else if let Some(s) = e.status() {
        format!("词库服务器返回 HTTP {}", s.as_u16())
    } else {
        "无法下载词库，请检查网络后重试".into()
    }
}

#[cfg(test)]
mod tests;
