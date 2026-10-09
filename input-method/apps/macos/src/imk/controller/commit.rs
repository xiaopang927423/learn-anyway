//! 上屏：高亮候选、指定候选、拼音原样。

use super::*;

impl WordMateInputController {
    pub(super) fn commit_highlighted(&self, client: TextClient<'_>) -> bool {
        let index = host::with(|h| h.session.highlighted).unwrap_or(0);
        self.commit_index(index, client)
    }

    pub(crate) fn choose_candidate(&self, index: usize, client: TextClient<'_>, translation: bool) {
        let review = host::with(|h| h.translation.clone()).flatten();
        if translation {
            if review.is_some() {
                self.handle_translation_review(49, client);
            } else {
                self.accept_wordmate(client, false);
            }
            return;
        }
        if let Some(job) = review {
            host::with(|h| h.end_translation());
            if !job.composition {
                return;
            }
            self.refresh(client);
            if let Some(candidate) = job.source_candidate {
                host::with(|h| h.session.reset(None, vec![candidate], h.page_size, 0));
                self.commit_index(0, client);
                return;
            }
        }
        self.commit_index(index, client);
    }

    /// 上屏第 `index` 个候选；没有候选时上屏拼音本身。上屏后剩余拼音继续组句。
    pub(super) fn commit_index(&self, index: usize, client: TextClient<'_>) -> bool {
        let candidate = host::with(|h| h.session.candidate(index)).flatten();
        let Some(candidate) = candidate else {
            if host::with(|h| index < h.session.layout.len()).unwrap_or(false) {
                return true;
            }
            if host::with(|h| h.sentence_confirmation || h.assistant.has_draft()).unwrap_or(false) {
                host::with(|h| {
                    let text = h.engine.composition().typed_text();
                    h.engine.clear();
                    if !text.is_empty() {
                        h.assistant.draft.push(crate::wordmate::DraftWord {
                            candidate: qingjian_core::Candidate {
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
                });
                self.refresh(client);
                return true;
            }
            return self.commit_raw(client);
        };
        let stage = host::with(|h| {
            (h.sentence_confirmation
                && candidate.kind != qingjian_core::CandidateKind::English
                && !h.engine.english_mode())
                || h.assistant.has_draft()
        })
        .unwrap_or(false);
        if stage {
            if host::with(|h| h.engine.composition().is_empty() && h.assistant.has_draft())
                .unwrap_or(false)
            {
                return self.commit_source(client);
            }
            host::with(|h| {
                if let Some((text, keys)) = h.engine.stage_candidate(&candidate) {
                    h.assistant.draft.push(crate::wordmate::DraftWord {
                        candidate: candidate.clone(),
                        keys,
                        text,
                    });
                }
            });
            self.refresh(client);
            return true;
        }
        let Some(text) = host::with(|h| h.engine.commit(&candidate)) else {
            return false;
        };

        client.insert_text(&text);
        host::with(|h| {
            h.assistant.note_text(&text);
            h.assistant.invalidate(false);
        });
        self.refresh(client);
        true
    }

    pub(crate) fn commit_source(&self, client: TextClient<'_>) -> bool {
        let (owned, cursor) = host::with(|h| {
            let draft = h.assistant.draft_text();
            let query = h.engine.query().ok();
            let cursor = draft.chars().count()
                + query
                    .as_ref()
                    .map(|query| query.marked_cursor())
                    .unwrap_or(0);
            (
                format!(
                    "{}{}",
                    draft,
                    query.map(|query| query.marked_text()).unwrap_or_default()
                ),
                cursor,
            )
        })
        .unwrap_or_default();
        let staged = host::with(|h| h.assistant.draft.clone()).unwrap_or_default();
        let output = host::with(|h| {
            let mut initial = if let Some(job) = &h.translation {
                job.source_candidate.clone()
            } else {
                h.session.candidate(h.session.highlighted)
            };
            while !h.engine.composition().is_empty() {
                let Some(candidate) = initial.take().or_else(|| {
                    h.engine
                        .query()
                        .ok()
                        .and_then(|query| query.candidates.items.into_iter().next())
                }) else {
                    let raw = h.engine.composition().typed_text();
                    h.engine.clear();
                    h.assistant.draft.push(crate::wordmate::DraftWord {
                        candidate: qingjian_core::Candidate {
                            text: raw.clone(),
                            kind: qingjian_core::CandidateKind::Generated,
                            syllables: Vec::new(),
                            reading: None,
                            translation: None,
                            aux_code: None,
                        },
                        keys: String::new(),
                        text: raw,
                    });
                    break;
                };
                let Some((text, keys)) = h.engine.stage_candidate(&candidate) else {
                    let text = h.engine.composition().typed_text();
                    h.engine.clear();
                    if !text.is_empty() {
                        h.assistant.draft.push(crate::wordmate::DraftWord {
                            candidate: qingjian_core::Candidate {
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
                    break;
                };
                h.assistant.draft.push(crate::wordmate::DraftWord {
                    candidate,
                    keys,
                    text,
                });
            }
            let output = h.assistant.draft_text();
            let parts: Vec<_> = h
                .assistant
                .draft
                .iter()
                .filter(|word| !word.keys.is_empty())
                .map(|word| (word.candidate.clone(), word.keys.clone()))
                .collect();
            if output.is_empty() {
                return None;
            }
            h.engine.commit_staged(&parts, &output);
            h.assistant.draft.clear();
            Some(output)
        })
        .flatten();
        let Some(output) = output else {
            return false;
        };
        let confirmed = client.insert_composition_verified(&output, &owned, cursor);
        host::with(|h| {
            h.assistant.note_text(&output);
            if confirmed {
                for word in &staged {
                    if word.candidate.kind != qingjian_core::CandidateKind::English
                        && word.text != word.candidate.text
                    {
                        h.assistant
                            .learn(word.text.trim(), &word.candidate.text, "annotation");
                    }
                }
            }
            h.assistant.invalidate(false);
        });
        self.refresh(client);
        true
    }

    /// 把拼音原样上屏并清空。缓冲区为空时返回 false。
    pub(super) fn commit_raw(&self, client: TextClient<'_>) -> bool {
        if secure_input::enabled() {
            host::with(|h| {
                h.engine.clear();
                h.assistant.draft.clear();
                h.assistant.invalidate(true);
            });
            return false;
        }
        if host::with(|h| h.assistant.has_draft()).unwrap_or(false) {
            return self.commit_source(client);
        }
        let Some(raw) = host::with(|h| h.engine.take_raw()) else {
            return false;
        };
        if raw.is_empty() {
            return false;
        }

        client.insert_text(&raw);
        host::with(|h| {
            h.assistant.note_text(&raw);
            h.assistant.invalidate(false);
        });
        self.refresh(client);
        true
    }
}
