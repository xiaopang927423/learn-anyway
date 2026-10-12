//! v0.6.0 English keyboard: word-local completion, literal word boundaries.
use super::*;

impl WordMateInputController {
    pub(super) fn toggle_keyboard(&self, client: TextClient<'_>) {
        if host::with(|h| h.is_composing()).unwrap_or(false) {
            self.commit_raw(client);
        }
        host::with(|h| {
            h.end_translation();
            h.assistant.invalidate(true);
            h.cancel_prediction();
        });
        modifiers::set_english_mode(!modifiers::english_mode());
        host::with(|h| h.indicator.update());
    }

    fn prepare_english(&self, client: TextClient<'_>) {
        let previous =
            host::with(|h| h.is_composing() && !h.engine.english_mode()).unwrap_or(false);
        if previous {
            self.commit_raw(client);
        }
        host::with(|h| {
            h.engine.set_english_mode(true);
            h.assistant.invalidate(true);
            h.cancel_prediction();
            h.indicator.update();
        });
    }

    pub(super) fn handle_english_text(&self, text: &str, client: TextClient<'_>) -> bool {
        self.note_application(&client);
        self.prepare_english(client);
        let candidates =
            host::with(|h| h.english_candidates_in(client.bundle_identifier().as_deref()))
                .unwrap_or(false);
        if !candidates {
            if host::with(|h| h.is_composing()).unwrap_or(false) {
                self.commit_raw(client);
            }
            host::with(|h| {
                for c in text.chars() {
                    h.engine.note_passthrough(c);
                }
            });
            return false;
        }
        let composing = host::with(|h| !h.engine.composition().is_empty()).unwrap_or(false);
        let single = text.chars().next().filter(|_| text.chars().count() == 1);
        if let Some(c) = single
            .filter(|c| c.is_ascii_alphanumeric() || (composing && matches!(c, '\'' | '_' | '-')))
        {
            host::with(|h| h.engine.push(c));
            self.refresh(client);
            return true;
        }
        if composing {
            self.commit_raw(client);
        }
        host::with(|h| {
            for c in text.chars() {
                h.engine.note_passthrough(c);
            }
        });
        false
    }

    pub(super) fn handle_english_event(&self, event: &NSEvent, client: TextClient<'_>) -> bool {
        self.note_application(&client);
        self.prepare_english(client);
        let flags = event.modifierFlags();
        let key = event.keyCode();
        let composing = host::with(|h| h.is_composing()).unwrap_or(false);
        let modified = flags.intersects(
            NSEventModifierFlags::Command
                | NSEventModifierFlags::Control
                | NSEventModifierFlags::Option,
        );
        if modified {
            if composing {
                self.commit_raw(client);
            }
            return false;
        }
        match key {
            49 => {
                let word = host::with(|h| h.engine.take_raw()).unwrap_or_default();
                let output = format!("{word} ");
                client.insert_text(&output);
                host::with(|h| {
                    h.engine.note_passthrough(' ');
                    h.assistant.note_text(&output);
                    h.assistant.invalidate(true);
                });
                self.refresh(client);
                true
            }
            48 if !flags.contains(NSEventModifierFlags::Shift) && composing => {
                self.confirm_source(client)
            }
            51 if composing => self.handle_command(sel!(deleteBackward:), client),
            53 if composing => {
                self.commit_raw(client);
                true
            }
            125 if composing => {
                self.move_highlight(1, client);
                true
            }
            126 if composing => {
                self.move_highlight(-1, client);
                true
            }
            36 | 76 if composing => {
                self.commit_raw(client);
                true
            }
            48 | 36 | 76 | 51 | 53 | 117 | 123 | 124 | 115 | 119 | 116 | 121 | 125 | 126 => {
                if composing {
                    self.commit_raw(client);
                }
                false
            }
            _ => event
                .characters()
                .filter(|s| !s.is_empty())
                .is_some_and(|text| self.handle_english_text(&text.to_string(), client)),
        }
    }
}
