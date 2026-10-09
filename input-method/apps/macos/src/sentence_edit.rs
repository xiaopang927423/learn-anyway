//! Unicode-safe editing shared by the native controller and its regression tests.
#[derive(Clone, Copy)]
pub enum Edit {
    Left,
    Right,
    Home,
    End,
    WordLeft,
    WordRight,
    Backspace,
    Delete,
    DeleteWord,
    DeleteStart,
}
pub fn apply(text: &mut String, cursor: &mut usize, action: Edit) {
    let mut chars: Vec<char> = text.chars().collect();
    *cursor = (*cursor).min(chars.len());
    match action {
        Edit::Left => *cursor = cursor.saturating_sub(1),
        Edit::Right => *cursor = (*cursor + 1).min(chars.len()),
        Edit::Home => *cursor = 0,
        Edit::End => *cursor = chars.len(),
        Edit::WordLeft | Edit::DeleteWord => {
            let end = *cursor;
            while *cursor > 0 && chars[*cursor - 1].is_whitespace() {
                *cursor -= 1;
            }
            while *cursor > 0 && !chars[*cursor - 1].is_whitespace() {
                *cursor -= 1;
            }
            if matches!(action, Edit::DeleteWord) {
                chars.drain(*cursor..end);
            }
        }
        Edit::WordRight => {
            while *cursor < chars.len() && !chars[*cursor].is_whitespace() {
                *cursor += 1;
            }
            while *cursor < chars.len() && chars[*cursor].is_whitespace() {
                *cursor += 1;
            }
        }
        Edit::Backspace if *cursor > 0 => {
            *cursor -= 1;
            chars.remove(*cursor);
        }
        Edit::Delete if *cursor < chars.len() => {
            chars.remove(*cursor);
        }
        Edit::DeleteStart => {
            chars.drain(..*cursor);
            *cursor = 0;
        }
        _ => {}
    }
    *text = chars.into_iter().collect();
}
pub fn insert(text: &mut String, cursor: &mut usize, value: &str) {
    let byte = text
        .char_indices()
        .nth(*cursor)
        .map_or(text.len(), |(i, _)| i);
    text.insert_str(byte, value);
    *cursor += value.chars().count();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spaces_and_editing_stay_in_owned_sentence() {
        let mut text = String::new();
        let mut cursor = 0;
        for word in ["I", "want", "to", "eat"] {
            insert(&mut text, &mut cursor, word);
            insert(&mut text, &mut cursor, " ");
        }
        insert(&mut text, &mut cursor, "早餐");
        assert_eq!(text, "I want to eat 早餐");
        apply(&mut text, &mut cursor, Edit::Home);
        apply(&mut text, &mut cursor, Edit::Right);
        insert(&mut text, &mut cursor, " really");
        assert_eq!(text, "I really want to eat 早餐");
        apply(&mut text, &mut cursor, Edit::End);
        apply(&mut text, &mut cursor, Edit::Backspace);
        assert_eq!(text, "I really want to eat 早");
        apply(&mut text, &mut cursor, Edit::DeleteWord);
        assert_eq!(text, "I really want to eat ");
    }
    #[test]
    fn unicode_deletion_and_cursor_bounds() {
        let mut text = "早餐😀".to_string();
        let mut cursor = 0;
        apply(&mut text, &mut cursor, Edit::Left);
        apply(&mut text, &mut cursor, Edit::Delete);
        assert_eq!(text, "餐😀");
        apply(&mut text, &mut cursor, Edit::WordRight);
        assert_eq!(cursor, 2);
        apply(&mut text, &mut cursor, Edit::DeleteStart);
        assert!(text.is_empty());
        assert_eq!(cursor, 0);
    }
}

/// Learn the translated Chinese span, preserving an existing English prefix/suffix.
/// If the model rewrites that context, do not mislabel the entire sentence as one word.
pub fn learning_fragment(source: &str, result: &str) -> Option<(String, String)> {
    let cjk = |c: char| ('\u{3400}'..='\u{9fff}').contains(&c);
    let start = source.char_indices().find(|(_, c)| cjk(*c))?.0;
    let (last, ch) = source.char_indices().rfind(|(_, c)| cjk(*c))?;
    let end = last + ch.len_utf8();
    let prefix = &source[..start];
    let suffix = &source[end..];
    if !prefix.is_ascii() || !suffix.is_ascii() {
        return None;
    }
    let translated = result.trim();
    if !translated
        .to_ascii_lowercase()
        .starts_with(&prefix.to_ascii_lowercase())
        || !translated
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
        || translated.len() < prefix.len() + suffix.len()
    {
        return None;
    }
    let fragment = translated
        .get(prefix.len()..translated.len() - suffix.len())?
        .trim()
        .trim_matches(|c: char| c.is_ascii_punctuation() && !matches!(c, '\'' | '-'));
    if fragment.is_empty() || !fragment.is_ascii() || fragment.split_whitespace().count() > 8 {
        return None;
    }
    Some((fragment.to_owned(), source[start..end].to_owned()))
}
#[cfg(test)]
mod learning_tests {
    use super::learning_fragment;
    #[test]
    fn mixed_sentence_learns_only_unknown_span() {
        assert_eq!(
            learning_fragment("I want to eat 早餐", "I want to eat breakfast"),
            Some(("breakfast".into(), "早餐".into()))
        );
        assert_eq!(
            learning_fragment("早餐", "breakfast"),
            Some(("breakfast".into(), "早餐".into()))
        );
        assert_eq!(
            learning_fragment("I want to eat 早餐", "I'd like breakfast"),
            None
        );
        assert_eq!(learning_fragment("I want", "我想"), None);
        assert_eq!(
            learning_fragment("I want to eat 早餐", "I want to eat breakfast."),
            Some(("breakfast".into(), "早餐".into()))
        );
    }
}
