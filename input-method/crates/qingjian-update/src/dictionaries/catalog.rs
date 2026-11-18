use super::MAX_DOWNLOAD;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Qingjian's public dictionary catalogue. Only compatible Chinese extra dictionaries are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub language: String,
    pub version: String,
    pub tag: String,
    pub bytes: u64,
    pub qj_format: u16,
    pub license: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub official: bool,
}

impl Entry {
    pub fn stem(&self) -> String {
        self.id
            .strip_prefix("domain-")
            .unwrap_or(&self.id)
            .replace('-', "_")
    }
    pub fn compatible(&self) -> bool {
        self.qj_format == 1
    }
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    #[derive(Deserialize)]
    struct Index {
        format: u32,
        dicts: Vec<Entry>,
        #[serde(default)]
        bundled: Vec<Entry>,
    }
    let index: Index = serde_json::from_slice(bytes).map_err(|_| "词库清单格式无效")?;
    if index.format != 1 {
        return Err("词库清单需要更新版本的输入法".into());
    }
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for e in index.dicts.into_iter().chain(index.bundled) {
        if e.kind != "extra" || e.language != "zh" || !e.official {
            continue;
        }
        if !safe_name(&e.id)
            || !safe_name(&e.tag)
            || e.tag != format!("{}-v{}", e.id, e.version)
            || crate::Version::parse(&e.version).is_none()
            || e.bytes == 0
            || e.bytes > MAX_DOWNLOAD
            || e.name.is_empty()
            || e.name.len() > 200
            || e.description.len() > 4000
            || e.license.is_empty()
            || !seen.insert(e.stem())
        {
            return Err("词库清单包含无效或重复条目".into());
        }
        entries.push(e);
    }
    if entries.is_empty() || entries.len() > 100 {
        return Err("没有可用的中文词库".into());
    }
    entries.sort_by_key(Entry::stem);
    Ok(entries)
}

pub(super) fn safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 150
        && !s.starts_with('.')
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        && !s.contains("..")
}
