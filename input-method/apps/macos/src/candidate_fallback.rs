//! Never present an owned nonempty composition as a candidate-less window.
use qingjian_core::{Candidate, CandidateKind};
pub fn ensure(candidates: &mut Vec<Candidate>, raw: &str, draft: &str) {
    if !candidates.is_empty() || (raw.is_empty() && draft.is_empty()) {
        return;
    }
    candidates.push(Candidate {
        text: raw.to_owned(),
        kind: if !raw.is_empty() && raw.bytes().all(|c| c.is_ascii_alphabetic()) {
            CandidateKind::English
        } else {
            CandidateKind::Generated
        },
        syllables: Vec::new(),
        reading: None,
        translation: None,
        aux_code: None,
    });
}
/// Keep an exact English spelling selectable even when it is absent from the dictionary.
pub fn ensure_literal(candidates: &mut Vec<Candidate>, raw: &str) {
    if raw.is_empty()
        || !raw.bytes().all(|c| c.is_ascii_alphabetic())
        || candidates
            .iter()
            .any(|c| c.kind == CandidateKind::English && c.text.eq_ignore_ascii_case(raw))
    {
        return;
    }
    let position = candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| matches!(c.kind, CandidateKind::Custom(_)))
        .map(|(i, _)| i + 1)
        .max()
        .unwrap_or(1)
        .min(candidates.len());
    candidates.insert(
        position,
        Candidate {
            text: raw.into(),
            kind: CandidateKind::English,
            syllables: Vec::new(),
            reading: None,
            translation: None,
            aux_code: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_input_and_drafts_keep_a_selectable_source() {
        let mut items = vec![];
        ensure(&mut items, "unknownword", "例如这种");
        assert_eq!(items[0].text, "unknownword");
        assert_eq!(items[0].kind, CandidateKind::English);
        let mut items = vec![];
        ensure(&mut items, "", "输入法存在");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "");
        let mut items = vec![];
        ensure(&mut items, "", "");
        assert!(items.is_empty());
    }
    #[test]
    fn unknown_english_spelling_is_available_without_displacing_custom_rules() {
        let mut items = vec![Candidate {
            text: "自定义内容".into(),
            kind: CandidateKind::Custom(1),
            syllables: vec![],
            reading: None,
            translation: None,
            aux_code: None,
        }];
        ensure_literal(&mut items, "Diffu");
        assert_eq!(items[0].kind, CandidateKind::Custom(1));
        assert_eq!(items[1].text, "Diffu");
        ensure_literal(&mut items, "Diffu");
        assert_eq!(items.len(), 2);
    }
}
