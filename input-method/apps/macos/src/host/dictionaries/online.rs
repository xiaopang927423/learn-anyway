use super::*;

impl Host {
    pub fn dictionary_work_pending(&self) -> bool {
        self.online_pending || self.online_dictionaries.as_ref().is_some_and(|m| m.busy)
    }
    pub fn check_dictionaries(&mut self, update: bool) {
        let enabled = if update {
            self.settings.config().dictionaries.domains.clone()
        } else {
            Vec::new()
        };
        if let Some(manager) = &mut self.online_dictionaries {
            manager.check(enabled);
        }
        self.watch.start();
        self.sync_dictionary_page();
    }
    pub fn download_dictionary(&mut self, index: usize) {
        let Some(id) = self
            .dictionary_list
            .get(index)
            .and_then(|i| i.download_id.clone())
        else {
            return;
        };
        if let Some(manager) = &mut self.online_dictionaries {
            if manager.busy {
                return;
            }
            manager.download(&id);
            self.online_enable = Some(id);
        }
        self.watch.start();
        self.sync_dictionary_page();
    }
    pub(super) fn dictionary_file_snapshot() -> Vec<(PathBuf, Option<std::time::SystemTime>, u64)> {
        let Some(dir) = paths::dicts_dir() else {
            return Vec::new();
        };
        let mut files = extra_dictionaries::snapshot(&dir);
        files.extend(extra_dictionaries::snapshot(&dir.join("online")));
        files
    }
    pub fn poll_dictionaries(&mut self) {
        // A separate settings process may have installed the file. Observe atomic replacements too.
        self.online_pending |= self.dictionary_files != Self::dictionary_file_snapshot();
        let config = self.settings.config().dictionaries.clone();
        let Some(manager) = &mut self.online_dictionaries else {
            return;
        };
        let (changed, installed) = manager.poll();
        self.online_pending |= !installed.is_empty();
        // Enable only a successfully installed, explicitly requested dictionary.
        if let Some(id) = &self.online_enable {
            if installed.contains(id) {
                if let Some(entry) = manager.entries.iter().find(|e| &e.id == id) {
                    self.online_ready.push(entry.stem());
                }
                self.online_enable = None;
            } else if !manager.busy {
                self.online_enable = None;
            }
        }
        if config.auto_update {
            manager.auto_check(config.domains);
        }
        if self.online_pending
            && self.engine.composition().is_empty()
            && self.session.preedit.is_none()
        {
            for stem in std::mem::take(&mut self.online_ready) {
                self.set_domain_enabled(&stem, true);
            }
            self.reload_dictionaries();
            self.online_pending = false;
            self.apply_config(false);
        } else if changed {
            self.sync_dictionary_page();
        }
    }
    pub fn sync_dictionary_page(&mut self) {
        self.dictionary_list = self.dictionary_infos();
        let status = self
            .online_dictionaries
            .as_ref()
            .map_or("词库目录不可写，无法下载", |m| {
                m.status.as_str()
            });
        let busy = self.online_dictionaries.as_ref().is_some_and(|m| m.busy);
        let words = self
            .engine
            .learner()
            .user_words()
            .map_or(0, Dictionary::len);
        self.preferences.sync_dictionaries(
            self.settings.config(),
            &self.dictionary_list,
            status,
            busy,
            words,
        );
    }
}
