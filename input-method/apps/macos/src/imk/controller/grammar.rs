use super::*;

impl WordMateInputController {
    pub(crate) fn poll_grammar() {
        if secure_input::enabled() || !modifiers::english_mode() {
            host::with(|h| { h.grammar.cancel(); h.assistant_panel.hide(); });
            return;
        }
        let state = host::with(|h| {
            if h.engine.is_private() || h.translation.is_some() {
                h.grammar.cancel(); h.assistant_panel.hide(); return None;
            }
            if h.is_composing() { return None; }
            Some((h.active_input.clone()?, h.grammar.generation, h.grammar.due()))
        }).flatten();
        let Some(((controller, object), generation, due)) = state else { return; };
        let client = TextClient::new(&object);
        if due {
            // Host reads can reenter/deactivate; recheck generation before sending.
            let snapshot = client.grammar_snapshot();
            host::with(|h| {
                if h.grammar.generation == generation && h.active_input.as_ref().is_some_and(|(c, o)| std::ptr::eq(&**c, &*controller) && std::ptr::eq(&**o, &*object)) {
                    h.grammar.submit(snapshot);
                }
            });
        }
        let changed = host::with(|h| h.grammar.poll()).unwrap_or(false);
        if !changed { return; }
        let snapshot = host::with(|h| h.grammar.snapshot.clone()).flatten();
        if let Some(snapshot) = snapshot {
            if !client.grammar_matches(&snapshot) {
                host::with(|h| { h.grammar.cancel(); h.assistant_panel.hide(); });
            } else if changed {
                let anchor = client.caret_rect();
                host::with(|h| {
                    if h.grammar.generation != generation { return; }
                    if let Some(result) = &h.grammar.result { h.assistant_panel.show_review(result, anchor); }
                    else { h.assistant_panel.hide(); }
                });
            }
        }
    }

    pub(crate) fn apply_grammar() {
        if secure_input::enabled() || !modifiers::english_mode() { return; }
        let value = host::with(|h| {
            if h.engine.is_private() || h.is_composing() { return None; }
            Some((h.active_input.clone()?, h.grammar.generation, h.grammar.snapshot.clone()?,
                h.grammar.result.as_ref()?["grammar"]["corrected"].as_str()?.to_owned()))
        }).flatten();
        let Some(((_controller, object), generation, snapshot, corrected)) = value else { return; };
        let client = TextClient::new(&object);
        let matches = client.grammar_matches(&snapshot);
        let still_current = host::with(|h| h.grammar.generation == generation).unwrap_or(false);
        if matches && still_current { client.replace_range_verified(&corrected, snapshot.range); }
        host::with(|h| { h.grammar.cancel(); h.assistant_panel.hide(); });
    }
}
