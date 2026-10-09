use super::init::{string_array, toggle_membership};
use super::*;
use qingjian_dictionary::AuxCodeTable;
use qingjian_platform::code_tables;
pub fn auxiliary_infos(config: &qingjian_platform::Config) -> Vec<DictionaryInfo> {
    let mut infos = Vec::new();
    let bundled = paths::resources_dir().ok().map(|p| p.join("codes"));
    let user = paths::user_data_dir().map(|p| p.join("codes"));
    for (dir, builtin) in [(bundled, true), (user, false)] {
        if let Some(dir) = dir {
            for (stem, path) in code_tables::list(&dir) {
                let table = AuxCodeTable::open(&path);
                let enabled = config.aux_code.is_enabled(&stem);
                let info = match table {
                    Ok(table) => DictionaryInfo {
                        name: table.metadata().map_or(stem.clone(), |m| m.name.clone()),
                        entries: table.len(),
                        license: table
                            .metadata()
                            .map_or(String::new(), |m| m.license.clone()),
                        enabled,
                        broken: false,
                        stem,
                        builtin,
                        path,
                    },
                    Err(_) => DictionaryInfo {
                        name: stem.clone(),
                        entries: 0,
                        license: String::new(),
                        enabled: false,
                        broken: true,
                        stem,
                        builtin,
                        path,
                    },
                };
                infos.push(info);
            }
        }
    }
    infos
}
impl Host {
    pub fn import_auxiliary(&mut self) {
        let Some(source) = crate::preferences::choose_dictionary_file() else {
            return;
        };
        let Some(dir) = paths::user_data_dir().map(|p| p.join("codes")) else {
            return;
        };
        match qingjian_dictionary::import_aux_code_table(&source, &dir) {
            Ok(imported) => {
                let r = imported.report;
                self.applied_aux = None;
                self.apply_config(true);
                self.preferences.set_status(&format!(
                    "已导入 {}：读取 {}，有码 {}，无码 {}，跳过 {}",
                    imported.name, r.read, r.with_code, r.no_code, r.skipped
                ));
            }
            Err(_) => self
                .preferences
                .set_status("导入失败：不是可用辅码表，原表保持"),
        }
    }
    pub fn toggle_auxiliary(&mut self, index: usize, on: bool) {
        let config = self.settings.config().clone();
        if let Some(info) = auxiliary_infos(&config).get(index) {
            if let Some(list) = toggle_membership(config.aux_code.disabled, &info.stem, !on) {
                self.settings.set_value(
                    "aux_code",
                    "disabled",
                    toml_edit::Value::Array(string_array(&list)),
                );
            }
        }
    }
    pub fn remove_auxiliary(&mut self, index: usize) {
        let config = self.settings.config().clone();
        let Some(info) = auxiliary_infos(&config).get(index).cloned() else {
            return;
        };
        if info.builtin {
            return;
        }
        let removed = info.path.parent().unwrap().join("removed");
        if std::fs::create_dir_all(&removed)
            .and_then(|_| std::fs::rename(&info.path, removed.join(info.path.file_name().unwrap())))
            .is_err()
        {
            self.preferences.set_status("移除失败，原表保持");
            return;
        }
        self.applied_aux = None;
        self.apply_config(true);
    }
}
