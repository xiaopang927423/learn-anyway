//! Candidate preparation shared by key events, recovery and asynchronous rescoring.
use super::*;

impl Host {
    pub(crate) fn prepare_candidates(&self, candidates: &mut Vec<Candidate>) {
        if self.engine.wants_english_space(&format!(
            "{}{}",
            self.assistant.context,
            self.assistant.draft_text()
        )) {
            let raw = self.engine.composition().typed_scope();
            let literal = candidates
                .iter()
                .position(|candidate| {
                    candidate.kind == qingjian_core::CandidateKind::English
                        && candidate.text.eq_ignore_ascii_case(&raw)
                })
                .map(|position| candidates.remove(position))
                .unwrap_or(qingjian_core::Candidate {
                    text: raw.clone(),
                    kind: qingjian_core::CandidateKind::English,
                    syllables: Vec::new(),
                    reading: None,
                    translation: None,
                    aux_code: None,
                });
            candidates.insert(
                0,
                qingjian_core::Candidate {
                    text: raw,
                    ..literal
                },
            );
        }
        crate::candidate_fallback::ensure_literal(
            candidates,
            &self.engine.composition().typed_scope(),
        );
        let draft = self.assistant.draft_text();
        if candidates.is_empty() && self.engine.composition().is_empty() && !draft.is_empty() {
            candidates.push(Candidate {
                text: String::new(),
                kind: CandidateKind::Generated,
                syllables: Vec::new(),
                reading: None,
                translation: if self.assistant.draft.len() == 1 {
                    self.assistant.draft[0].candidate.translation.clone()
                } else {
                    None
                },
                aux_code: None,
            });
        }
        crate::candidate_fallback::ensure(
            candidates,
            &self.engine.composition().typed_scope(),
            &draft,
        );
    }
}
