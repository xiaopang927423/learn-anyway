//! 附加词库：随包的领域词库（`Resources/dicts/`，按 `[dictionaries] domains` 挑）与用户目录 `dicts/` 下的 `.qj`（或 TSV）
//! 文件（按 `[dictionaries] disabled` 过滤），加载后一起接到 Engine 上。

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::DictionariesConfig;
use qingjian_dictionary::Dictionary;

/// 目录里能加载的扩展名，靠前的优先：同名的 `.qj` 与 `.tsv` 只取 `.qj`（开发目录里两者并存）。
const EXTENSIONS: [&str; 2] = ["qj", "tsv"];

/// 可加载文件的快照：用于发现新增、移除与同名更新，不读取词库正文。
pub fn snapshot(dir: &Path) -> Vec<(PathBuf, Option<SystemTime>, u64)> {
    list(dir)
        .into_iter()
        .filter_map(|(_, path)| {
            let metadata = std::fs::metadata(&path).ok()?;
            Some((path, metadata.modified().ok(), metadata.len()))
        })
        .collect()
}

/// 列出目录里的词库文件（按文件名排序，同名只留优先扩展名的那个），返回 (文件名不含扩展名, 路径)。目录不存在就是空。
pub fn list(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(String, usize, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter_map(|p| {
            let extension = p.extension()?.to_str()?;
            let rank = EXTENSIONS.iter().position(|e| *e == extension)?;
            let stem = p.file_stem()?.to_str()?.to_owned();
            Some((stem, rank, p))
        })
        .collect();
    files.sort();
    files.dedup_by(|a, b| a.0 == b.0);
    files
        .into_iter()
        .map(|(stem, _, path)| (stem, path))
        .collect()
}

/// 加载没被关掉的词库：先随包领域词库，再用户目录。坏文件只记日志、跳过：一本词库坏了不能拖垮输入法。
pub fn load(
    bundled_dir: Option<&Path>,
    user_dir: Option<&Path>,
    config: &DictionariesConfig,
) -> Vec<Dictionary> {
    let mut loaded = Vec::new();
    for (stem, paths) in domain_paths(bundled_dir, user_dir) {
        if config.is_domain_enabled(&stem) {
            // Online copy shadows the bundled one; a damaged update falls back to the bundle.
            loaded.extend(paths.into_iter().find_map(|path| open(&stem, &path)));
        }
    }
    if let Some(dir) = user_dir {
        for (stem, path) in list(dir) {
            if !config.is_enabled(&stem) {
                tracing::debug!(name = %stem, "附加词库已关闭，跳过");
                continue;
            }
            loaded.extend(open(&stem, &path));
        }
    }
    loaded
}

/// Online dictionaries and bundled domains share one switch and are loaded only once.
/// Paths are in priority order, leaving a bundled fallback if the online file becomes damaged.
pub fn domain_paths(
    bundled_dir: Option<&Path>,
    user_dir: Option<&Path>,
) -> Vec<(String, Vec<PathBuf>)> {
    let mut files = std::collections::BTreeMap::<String, Vec<PathBuf>>::new();
    if let Some(user) = user_dir {
        for (stem, path) in list(&user.join("online")) {
            files.entry(stem).or_default().push(path);
        }
    }
    if let Some(bundled) = bundled_dir {
        for (stem, path) in list(bundled) {
            files.entry(stem).or_default().push(path);
        }
    }
    files.into_iter().collect()
}

fn open(stem: &str, path: &Path) -> Option<Dictionary> {
    match Dictionary::from_path(path) {
        Ok(dictionary) if !dictionary.is_empty() => {
            tracing::info!(
                name = %dictionary.metadata().map_or(stem, |m| m.name.as_str()),
                file = %path.display(),
                entries = dictionary.len(),
                license = %dictionary.metadata().map_or("", |m| m.license.as_str()),
                "附加词库已加载"
            );
            Some(dictionary)
        }
        Ok(_) => None,
        Err(error) => {
            tracing::warn!(file = %path.display(), %error, "附加词库加载失败，跳过");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_prefers_packed_over_tsv_with_same_stem() {
        let dir = std::env::temp_dir().join(format!("qingjian-extra-dicts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["idioms.qj", "idioms.tsv", "food.tsv", "notes.txt"] {
            std::fs::write(dir.join(name), b"").unwrap();
        }

        let listed = list(&dir);
        let names: Vec<(&str, &str)> = listed
            .iter()
            .map(|(stem, path)| (stem.as_str(), path.file_name().unwrap().to_str().unwrap()))
            .collect();
        assert_eq!(names, [("food", "food.tsv"), ("idioms", "idioms.qj")]);
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn online_domain_shadows_bundle_and_corruption_falls_back_without_duplicates() {
        let dir =
            std::env::temp_dir().join(format!("wordmate-domain-fallback-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let bundle = dir.join("bundle");
        let user = dir.join("user");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::create_dir_all(user.join("online")).unwrap();
        std::fs::write(bundle.join("idioms.tsv"), "星河\txing he\t30\n").unwrap();
        std::fs::write(user.join("online/idioms.tsv"), "星禾\txing he\t40\n").unwrap();
        let config = DictionariesConfig::default();
        let loaded = load(Some(&bundle), Some(&user), &config);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].lookup(&["xing", "he"], false)[0].text, "星禾");
        std::fs::write(user.join("online/idioms.tsv"), "broken").unwrap();
        let loaded = load(Some(&bundle), Some(&user), &config);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].lookup(&["xing", "he"], false)[0].text, "星河");
        let off = DictionariesConfig {
            domains: vec![],
            ..Default::default()
        };
        assert!(load(Some(&bundle), Some(&user), &off).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
