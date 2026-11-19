//! Debounced English review. Never sends keys or mutates host text from a worker.
use objc2_foundation::NSRange;
use serde_json::{Value, json};
use std::sync::{Arc, atomic::{AtomicU64, Ordering}, mpsc::{self, Receiver, Sender}};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub source: String,
    pub range: NSRange,
    pub caret: usize,
}

/// Locate the last sentence within an exact UTF-16 host range, preserving offsets.
pub fn snapshot(before: &str, caret: usize) -> Option<Snapshot> {
    let trimmed = before.trim_end();
    let without_terminal = trimmed.trim_end_matches(['.', '!', '?']);
    let start = without_terminal.rfind(['.', '!', '?', '\n', '\r'])
        .map_or(0, |i| i + 1);
    let source = trimmed.get(start..)?.trim_start();
    if source.len() > 1000 || source.split_whitespace().count() < 3
        || source.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
        || !source.chars().any(|c| c.is_ascii_alphabetic()) { return None; }
    let trailing = before[trimmed.len()..].encode_utf16().count();
    let length = source.encode_utf16().count();
    Some(Snapshot { source: source.into(), range: NSRange::new(caret.checked_sub(trailing + length)?, length), caret })
}

pub struct Grammar {
    pub generation: u64,
    last_edit: Option<Instant>,
    attempted: bool,
    pub snapshot: Option<Snapshot>,
    pub result: Option<Value>,
    current: Arc<AtomicU64>,
    tx: Sender<(u64, Snapshot)>,
    rx: Receiver<(u64, Result<Value, String>)>,
}
impl Grammar {
    pub fn new() -> Self {
        let (tx, work) = mpsc::channel::<(u64, Snapshot)>();
        let (done, rx) = mpsc::channel();
        let current = Arc::new(AtomicU64::new(0));
        let worker_current = current.clone();
        std::thread::spawn(move || {
            while let Ok((mut generation, mut snapshot)) = work.recv() {
                while let Ok((g, s)) = work.try_recv() { generation = g; snapshot = s; }
                if worker_current.load(Ordering::Acquire) != generation { continue; }
                let preferences = crate::wordmate::rpc("preferences.get", json!({}));
                if worker_current.load(Ordering::Acquire) != generation { continue; }
                let result = match preferences {
                    Ok(p) if p["enabled"] == true && p["grammarEnabled"] == true => {
                        crate::wordmate::rpc_cancellable("grammar.check", json!({"text":snapshot.source}), Some((&worker_current, generation)))
                    }
                    _ => Err("NOT_CONFIGURED".into()),
                };
                if done.send((generation, result)).is_err() { break; }
            }
        });
        Self { generation: 0, last_edit: None, attempted: false, snapshot: None, result: None, current, tx, rx }
    }
    pub fn cancel(&mut self) {
        self.generation += 1;
        self.current.store(self.generation, Ordering::Release);
        self.last_edit = None; self.attempted = false; self.snapshot = None; self.result = None;
    }
    pub fn edited(&mut self) { self.cancel(); self.last_edit = Some(Instant::now()); }
    pub fn due(&self) -> bool {
        !self.attempted && self.last_edit.is_some_and(|t| t.elapsed() >= Duration::from_millis(1200))
    }
    pub fn submit(&mut self, snapshot: Option<Snapshot>) {
        self.attempted = true;
        if let Some(snapshot) = snapshot {
            self.snapshot = Some(snapshot.clone());
            let _ = self.tx.send((self.generation, snapshot));
        }
    }
    pub fn poll(&mut self) -> bool {
        let mut changed = false;
        while let Ok((generation, result)) = self.rx.try_recv() {
            if generation == self.generation {
                self.result = result.ok().filter(|r| r["grammar"]["status"] == "issues"
                    && self.snapshot.as_ref().is_some_and(|s| r["original"].as_str() == Some(&s.source)));
                changed = true;
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sentence_range_tracks_utf16_and_trailing_spaces() {
        let text = "😀 Earlier sentence.  She go to school. ";
        let s = snapshot(text, text.encode_utf16().count()).unwrap();
        assert_eq!(s.source, "She go to school.");
        let units: Vec<_> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[s.range.location..s.range.location+s.range.length]).unwrap(), s.source);
    }
    #[test]
    fn skips_short_and_non_english_text() {
        assert!(snapshot("hello",5).is_none());
        assert!(snapshot("我 want to go",12).is_none());
        assert!(snapshot("I have a question",17).is_some());
    }
    #[test]
    fn stale_response_cannot_reappear_after_edit() {
        let mut grammar = Grammar::new();
        grammar.edited();
        let old = grammar.generation;
        grammar.cancel();
        assert_ne!(grammar.generation, old);
        assert_eq!(grammar.current.load(Ordering::Acquire), grammar.generation);
        assert!(!grammar.due());
    }
}
