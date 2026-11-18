//! A rolling window adapts to new habits without destroying lifetime counts or learned words.
use super::*;
const WINDOW: usize = 16;
const FILE: &str = "user-recent-choices.tsv";
impl FrequencyLearner {
    pub(super) fn note_recent(&mut self, input: &str, text: &str) {
        let queue = self.recent.entry(input.to_owned()).or_default();
        queue.push_back(text.to_owned());
        while queue.len() > WINDOW {
            queue.pop_front();
        }
        self.recent_dirty = true;
        if self.recent.len() > MAX_CHOICE_ENTRIES {
            self.recent.retain(|key, _| self.choices.contains_key(key));
        }
    }
    pub(super) fn recent_weight(&self, input: &str, text: &str) -> u32 {
        let total = self.choice_weight(input, text);
        if total == 0 {
            return 0;
        }
        let recent = self
            .recent
            .get(input)
            .map_or(0, |q| q.iter().filter(|s| *s == text).count() as u32);
        total.min(15) + recent * 16
    }
    pub(super) fn undo_recent(&mut self, input: &str, text: &str) {
        if let Some(queue) = self.recent.get_mut(input) {
            if let Some(index) = queue.iter().rposition(|s| s == text) {
                queue.remove(index);
                self.recent_dirty = true;
            }
            if queue.is_empty() {
                self.recent.remove(input);
            }
        }
    }
    pub(super) fn forget_recent(&mut self, text: &str) {
        for queue in self.recent.values_mut() {
            queue.retain(|s| s != text);
        }
        self.recent.retain(|_, q| !q.is_empty());
        self.recent_dirty = true;
    }
    pub(super) fn load_recent(&mut self, path: &Path) -> Result<(), LearningError> {
        if let Some(source) = read_text_lossy(&path.with_file_name(FILE))? {
            for line in data_lines(&source) {
                if let Some((input, text)) = line.split_once('\t') {
                    if self.choice_weight(input, text) > 0 {
                        self.note_recent(input, text);
                    }
                }
            }
        }
        self.recent_dirty = false;
        Ok(())
    }
    pub(super) fn save_recent(&mut self, path: &Path) -> Result<(), LearningError> {
        if !self.recent_dirty {
            return Ok(());
        }
        let ordered: BTreeMap<_, _> = self.recent.iter().collect();
        write_atomic(&path.with_file_name(FILE), |file| {
            writeln!(
                file,
                "# WordMate 近期选词：每个拼音保留最近 16 次确认，按时间先后"
            )?;
            for (input, queue) in ordered {
                for text in queue {
                    writeln!(file, "{input}\t{text}")?;
                }
            }
            Ok(())
        })?;
        self.recent_dirty = false;
        Ok(())
    }
}
