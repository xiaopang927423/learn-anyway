//! Staging and editing never insert text into the application.
use super::*;
use crate::sentence_edit::Edit;

impl WordMateInputController {
    pub(super) fn insert_draft_space(&self, client: TextClient<'_>) -> bool {
        host::with(|h| {
            if let Some(mut cursor) = h.assistant.draft_cursor {
                let mut text = h.assistant.draft_text();
                let raw = h.engine.composition().typed_text();
                h.engine.clear();
                crate::sentence_edit::insert(&mut text, &mut cursor, &format!("{raw} "));
                h.assistant.set_edited_draft(text, cursor);
            } else {
                // Literal-space means preserve typed English, regardless of pinyin ranking.
                let mut text = h.engine.composition().typed_text();
                h.engine.clear();
                text.push(' ');
                h.assistant.stage_word(crate::wordmate::DraftWord {
                    candidate: Candidate {
                        text: text.clone(),
                        kind: qingjian_core::CandidateKind::Generated,
                        syllables: Vec::new(),
                        reading: None,
                        translation: None,
                        aux_code: None,
                    },
                    keys: String::new(),
                    text,
                });
            }
            h.cancel_prediction();
        });
        self.refresh(client);
        true
    }

    pub(super) fn edit_draft_command(
        &self,
        selector: objc2::runtime::Sel,
        client: TextClient<'_>,
    ) -> bool {
        let action = if selector == sel!(moveLeft:) {
            Edit::Left
        } else if selector == sel!(moveRight:) {
            Edit::Right
        } else if selector == sel!(moveWordLeft:) {
            Edit::WordLeft
        } else if selector == sel!(moveWordRight:) {
            Edit::WordRight
        } else if selector == sel!(moveToBeginningOfLine:) || selector == sel!(moveToLeftEndOfLine:)
        {
            Edit::Home
        } else if selector == sel!(moveToEndOfLine:) || selector == sel!(moveToRightEndOfLine:) {
            Edit::End
        } else if selector == sel!(deleteBackward:) {
            Edit::Backspace
        } else if selector == sel!(deleteForward:) {
            Edit::Delete
        } else if selector == sel!(deleteWordBackward:) {
            Edit::DeleteWord
        } else if selector == sel!(deleteToBeginningOfLine:) {
            Edit::DeleteStart
        } else {
            return false;
        };
        let handled = host::with(|h| {
            if !h.assistant.has_draft() && h.assistant.draft_cursor.is_none() {
                return false;
            }
            let navigation = matches!(
                action,
                Edit::Left
                    | Edit::Right
                    | Edit::Home
                    | Edit::End
                    | Edit::WordLeft
                    | Edit::WordRight
            );
            if !navigation
                && h.assistant.draft_cursor.is_none()
                && !h.engine.composition().is_empty()
            {
                return false;
            }
            if h.assistant.draft_cursor.is_some() && !h.engine.composition().is_empty() {
                match action {
                    Edit::Backspace if h.engine.composition().cursor() > 0 => {
                        h.engine.backspace();
                        return true;
                    }
                    Edit::Delete
                        if h.engine.composition().cursor()
                            < h.engine.composition().text().chars().count() =>
                    {
                        h.engine.delete_forward();
                        return true;
                    }
                    Edit::Backspace | Edit::Delete => {
                        let mut text = h.assistant.draft_text();
                        let mut cursor = h.assistant.draft_cursor.unwrap_or(0);
                        crate::sentence_edit::apply(&mut text, &mut cursor, action);
                        h.assistant.set_edited_draft(text, cursor);
                        return true;
                    }
                    Edit::DeleteWord => {
                        h.engine.delete_syllable_backward();
                        return true;
                    }
                    Edit::DeleteStart => {
                        h.engine.delete_to_start();
                        return true;
                    }
                    Edit::Left if h.engine.composition().cursor() > 0 => {
                        h.engine.move_cursor_left();
                        return true;
                    }
                    Edit::Right
                        if h.engine.composition().cursor()
                            < h.engine.composition().text().chars().count() =>
                    {
                        h.engine.move_cursor_right();
                        return true;
                    }
                    _ => {}
                }
            }
            freeze_pending(h);
            let mut text = h.assistant.draft_text();
            let mut cursor = h
                .assistant
                .draft_cursor
                .unwrap_or_else(|| text.chars().count());
            crate::sentence_edit::apply(&mut text, &mut cursor, action);
            h.assistant.set_edited_draft(text, cursor);
            // End resumes phonetic input at the end of the retained sentence.
            if matches!(action, Edit::End) {
                h.assistant.draft_cursor = None;
            }
            h.cancel_prediction();
            true
        })
        .unwrap_or(false);
        if handled {
            self.refresh(client);
        }
        handled
    }
}

/// Convert the pending token at the editor caret, preserving both sides of the frozen text.
pub(super) fn freeze_pending(h: &mut crate::host::Host) {
    let mut selected = if h.session.navigated
        || h.engine.composition().cursor() == h.engine.composition().text().chars().count()
    {
        h.session.candidate(h.session.highlighted)
    } else {
        None
    };
    // Query the whole pending token before freezing; a caret at its start has an empty scope.
    h.engine.move_cursor_end();
    while !h.engine.composition().is_empty() {
        let candidate = selected.take().or_else(|| {
            h.engine
                .query()
                .ok()
                .and_then(|q| q.candidates.items.into_iter().next())
        });
        if let Some((text, keys)) = candidate.as_ref().and_then(|c| h.engine.stage_candidate(c)) {
            h.assistant.stage_word(crate::wordmate::DraftWord {
                candidate: candidate.unwrap(),
                keys,
                text,
            });
        } else {
            let text = h.engine.composition().typed_text();
            h.engine.clear();
            h.assistant.stage_word(crate::wordmate::DraftWord {
                candidate: Candidate {
                    text: text.clone(),
                    kind: qingjian_core::CandidateKind::Generated,
                    syllables: vec![],
                    reading: None,
                    translation: None,
                    aux_code: None,
                },
                keys: String::new(),
                text,
            });
        }
    }
}
