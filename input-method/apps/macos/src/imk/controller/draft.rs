//! Staging and editing never insert text into the application.
use super::*;
use crate::sentence_edit::Edit;

impl WordMateInputController {
    pub(super) fn insert_draft_space(&self, client: TextClient<'_>) -> bool {
        host::with(|h| {
            if let Some(mut cursor) = h.assistant.draft_cursor {
                let mut text = h.assistant.draft_text();
                crate::sentence_edit::insert(&mut text, &mut cursor, " ");
                h.assistant.set_edited_draft(text, cursor);
            } else {
                // Literal-space means preserve typed English, regardless of pinyin ranking.
                let mut text = h.engine.composition().typed_text();
                h.engine.clear();
                text.push(' ');
                h.assistant.draft.push(crate::wordmate::DraftWord {
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
            // Freeze the selected interpretation before moving into an earlier token.
            let mut selected = h.session.candidate(h.session.highlighted);
            while !h.engine.composition().is_empty() {
                let candidate = selected.take().or_else(|| {
                    h.engine
                        .query()
                        .ok()
                        .and_then(|q| q.candidates.items.into_iter().next())
                });
                let staged = candidate.as_ref().and_then(|c| h.engine.stage_candidate(c));
                if let Some((text, keys)) = staged {
                    h.assistant.draft.push(crate::wordmate::DraftWord {
                        candidate: candidate.unwrap(),
                        keys,
                        text,
                    });
                } else {
                    let raw = h.engine.composition().typed_text();
                    h.engine.clear();
                    let text = format!("{}{raw}", h.assistant.draft_text());
                    let cursor = text.chars().count();
                    h.assistant.set_edited_draft(text, cursor);
                    break;
                }
            }
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
