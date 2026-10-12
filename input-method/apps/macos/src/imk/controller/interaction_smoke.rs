//! In-process IMK client fixture. Exercises the actual NSEvent dispatch, not only Engine APIs.
use super::*;
use objc2::{AnyThread, DefinedClass};
use objc2_foundation::{
    NSAttributedString, NSDictionary, NSNotFound, NSObject, NSPoint, NSRange, NSRect, NSString,
};
use std::cell::{Cell, RefCell};

#[derive(Default)]
struct State {
    marked: RefCell<String>,
    committed: RefCell<String>,
    writes: RefCell<Vec<String>>,
    cursor: Cell<usize>,
    selection_length: Cell<usize>,
    inserts: Cell<usize>,
    bundle: RefCell<String>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = State]
    struct FixtureClient;
    impl FixtureClient {
        #[unsafe(method(setMarkedText:selectionRange:replacementRange:))]
        fn mark(&self, text: &NSString, selection: NSRange, _replacement: NSRange) {
            *self.ivars().marked.borrow_mut() = text.to_string(); self.ivars().cursor.set(selection.location);
        }
        #[unsafe(method(insertText:replacementRange:))]
        fn insert(&self, text: &NSString, _replacement: NSRange) {
            *self.ivars().committed.borrow_mut() = text.to_string();
            self.ivars().writes.borrow_mut().push(text.to_string());
            self.ivars().marked.borrow_mut().clear();
            self.ivars().cursor.set(text.length()); self.ivars().selection_length.set(0); self.ivars().inserts.set(self.ivars().inserts.get()+1);
        }
        #[unsafe(method(markedRange))]
        fn marked_range(&self) -> NSRange {
            if self.ivars().marked.borrow().is_empty() { NSRange::new(NSNotFound as usize,0) }
            else { NSRange::new(0,self.ivars().marked.borrow().encode_utf16().count()) }
        }
        #[unsafe(method(selectedRange))]
        fn selected_range(&self) -> NSRange { NSRange::new(self.ivars().cursor.get(),self.ivars().selection_length.get()) }
        #[unsafe(method(length))]
        fn length(&self) -> usize { self.ivars().marked.borrow().encode_utf16().count()+self.ivars().committed.borrow().encode_utf16().count() }
        #[unsafe(method_id(bundleIdentifier))]
        fn bundle(&self) -> Option<Retained<NSString>> { Some(NSString::from_str(if self.ivars().bundle.borrow().is_empty() { "org.wordmate.fixture".into() } else { self.ivars().bundle.borrow().clone() }.as_str())) }
        #[unsafe(method_id(attributedSubstringFromRange:))]
        fn substring(&self, range: NSRange) -> Option<Retained<NSAttributedString>> {
            let text = if self.ivars().marked.borrow().is_empty() { self.ivars().committed.borrow().clone() } else { self.ivars().marked.borrow().clone() };
            let units: Vec<u16> = text.encode_utf16().collect();
            range.location.checked_add(range.length)
                .and_then(|end| units.get(range.location..end))
                .and_then(|units| String::from_utf16(units).ok())
                .map(|value| NSAttributedString::initWithString(NSAttributedString::alloc(), &NSString::from_str(&value)))
        }
        #[unsafe(method_id(attributesForCharacterIndex:lineHeightRectangle:))]
        fn attributes(&self, _index: usize, _rect: *mut NSRect) -> Option<Retained<NSDictionary>> { None }
    }
    unsafe impl NSObjectProtocol for FixtureClient {}
);

pub(crate) fn run() {
    let allocated = FixtureClient::alloc().set_ivars(State::default());
    let fixture: Retained<FixtureClient> = unsafe { msg_send![super(allocated), init] };
    let object: &AnyObject = &fixture;
    // No system IMK connection: this fixture tests our dispatch against a fake text client.
    let allocated = WordMateInputController::alloc().set_ivars(InputState::default());
    let controller: Retained<WordMateInputController> =
        unsafe { msg_send![super(allocated), init] };
    let client = TextClient::new(object);
    let event = |characters: &str, code: u16, flags: NSEventModifierFlags| {
        let string = NSString::from_str(characters);
        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            NSEventType::KeyDown, NSPoint::ZERO, flags, 0., 0, None, &string, &string, false, code).expect("fixture key event");
        assert!(
            controller.dispatch_event(&event, client),
            "unhandled fixture key {code}"
        );
    };
    let none = NSEventModifierFlags::empty();
    host::with(|h| h.sentence_confirmation = true);
    for c in "nihao".chars() {
        event(&c.to_string(), 0, none);
    }
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "你好");
    assert_eq!(
        fixture.ivars().inserts.get(),
        1,
        "one Space must adopt even with staging enabled"
    );
    assert!(fixture.ivars().marked.borrow().is_empty());
    host::with(|h| {
        assert!(
            !h.window.is_visible(),
            "confirmed complete input must close the window"
        )
    });
    fixture.ivars().inserts.set(0);
    for c in "nihaoma".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.text == "你" && c.kind == qingjian_core::CandidateKind::Chinese
                })
            })
            .expect("partial candidate")
    });
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "你");
    assert_eq!(fixture.ivars().inserts.get(), 1);
    host::with(|h| {
        assert_eq!(
            h.engine.composition().typed_text(),
            "haoma",
            "unselected suffix must remain editable"
        )
    });
    host::with(|h| h.engine.clear());
    controller.refresh(client);
    host::with(|h| {
        h.assistant.set_edited_draft("例如这种".into(), 4);
        h.assistant.draft_cursor = None;
        h.assistant.context.clear();
    });
    for c in "space".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.kind == qingjian_core::CandidateKind::English && c.text == "space"
                })
            })
            .expect("mixed English candidate");
    });
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "例如这种space");
    assert_eq!(
        fixture.ivars().inserts.get(),
        2,
        "mixed English must adopt once, without substituting Chinese"
    );
    assert!(fixture.ivars().marked.borrow().is_empty());
    host::with(|h| {
        h.assistant.set_edited_draft("例如这种".into(), 4);
        h.assistant.draft_cursor = None;
    });
    for c in "space".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.kind == qingjian_core::CandidateKind::English && c.text == "space"
                })
            })
            .unwrap()
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(&*fixture.ivars().committed.borrow(), "例如这种space");
    assert_eq!(
        fixture.ivars().inserts.get(),
        3,
        "Option-Space must preserve Chinese around an English source"
    );
    host::with(|h| {
        h.assistant.set_edited_draft("例如这种".into(), 4);
        h.assistant.draft_cursor = None;
    });
    for c in "diffu".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.kind == qingjian_core::CandidateKind::English && c.text == "diffu"
                })
            })
            .expect("unknown English must remain selectable")
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(&*fixture.ivars().committed.borrow(), "例如这种diffu");
    assert_eq!(fixture.ivars().inserts.get(), 4);
    host::with(|h| {
        assert!(
            h.engine
                .learner()
                .user_english()
                .is_some_and(|words| words.get("diffu").is_some()),
            "adopted unknown English must enter personal dictionary"
        )
    });
    host::with(|h| {
        h.engine.set_input("nihao");
        h.session.reset(None, vec![], h.page_size, 0);
        h.window.hide();
        h.render();
        assert!(
            h.session.candidate(h.session.highlighted).is_some(),
            "lost session must recover local candidate"
        );
        assert!(
            h.window.is_visible(),
            "owned input must recover its candidate window"
        );
        h.engine.clear();
        h.sentence_confirmation = false;
    });
    fixture.ivars().marked.borrow_mut().clear();
    fixture.ivars().committed.borrow_mut().clear();
    fixture.ivars().cursor.set(0);
    fixture.ivars().inserts.set(0);
    host::with(|h| {
        h.assistant.invalidate(true);
        h.engine.clear();
        h.assistant.draft.clear();
        h.assistant.draft_cursor = None;
        h.cancel_prediction();
    });
    for word in ["I", "want", "to", "eat"] {
        for c in word.chars() {
            event(&c.to_string(), 0, none);
        }
        event("\t", 48, none);
    }
    assert_eq!(&*fixture.ivars().marked.borrow(), "I want to eat ");
    assert_eq!(fixture.ivars().inserts.get(), 0, "Tab submitted to app");
    for c in "zaocan".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        let index = (0..h.session.layout.len())
            .find(|&i| h.session.candidate(i).is_some_and(|c| c.text == "早餐"))
            .expect("breakfast candidate");
        h.session.highlighted = index;
    });
    // Conversion via candidate click stays in draft; Space itself now adopts immediately.
    let breakfast_index = host::with(|h| h.session.highlighted).unwrap();
    controller.choose_candidate(breakfast_index, client, false);
    assert_eq!(&*fixture.ivars().marked.borrow(), "I want to eat 早餐");
    event("", 123, NSEventModifierFlags::Command);
    event("", 124, none);
    event("\t", 48, none);
    for c in "really".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        assert_eq!(
            h.assistant
                .composition_text(&h.session.candidate(h.session.highlighted).unwrap().text),
            "I really want to eat 早餐"
        )
    });
    assert_eq!(fixture.ivars().inserts.get(), 0, "editing submitted to app");
    event("", 124, NSEventModifierFlags::Command);
    assert_eq!(
        &*fixture.ivars().marked.borrow(),
        "I really want to eat 早餐"
    );
    event(
        "t",
        17,
        NSEventModifierFlags::Control | NSEventModifierFlags::Option,
    );
    host::with(|h| {
        assert_eq!(
            h.translation.as_ref().expect("sentence preview").source,
            "I really want to eat 早餐"
        );
    });
    event("\r", 36, none);
    assert_eq!(
        fixture.ivars().inserts.get(),
        0,
        "Enter in preview must not submit"
    );
    // Model is deterministic in this fixture; real transport is tested separately.
    host::with(|h| {
        h.translation.as_mut().expect("preview").result =
            Some("I really want to eat breakfast".into());
        h.assistant.text = Some("I really want to eat breakfast".into());
        h.assistant.meaning = "早餐".into();
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(
        &*fixture.ivars().committed.borrow(),
        "I really want to eat breakfast"
    );
    assert_eq!(fixture.ivars().inserts.get(), 1);
    for c in "nihao".chars() {
        event(&c.to_string(), 0, none);
    }
    let selected_source = host::with(|h| {
        let index = (1..h.session.layout.len())
            .find(|&i| {
                h.session
                    .candidate(i)
                    .is_some_and(|c| c.kind == qingjian_core::CandidateKind::Chinese)
            })
            .expect("non-first candidate");
        h.session.highlighted = index;
        h.session.candidate(index).unwrap().text
    })
    .unwrap();
    event(
        "t",
        17,
        NSEventModifierFlags::Control | NSEventModifierFlags::Option,
    );
    host::with(|h| assert_eq!(h.translation.as_ref().unwrap().source, selected_source));
    event("", 53, none);
    event("", 53, none);
    assert_eq!(fixture.ivars().inserts.get(), 1);
    *fixture.ivars().committed.borrow_mut() = "早餐".into();
    fixture.ivars().cursor.set(0);
    fixture.ivars().selection_length.set(2);
    event(
        "t",
        17,
        NSEventModifierFlags::Control | NSEventModifierFlags::Option,
    );
    event(" ", 49, NSEventModifierFlags::Option);
    host::with(|h| {
        let job = h.translation.as_mut().expect("selection preview");
        assert!(!job.composition);
        assert_eq!(job.source, "早餐");
        job.result = Some("breakfast".into());
        h.assistant.text = Some("breakfast".into());
    });
    WordMateInputController::poll_adoption();
    assert_eq!(&*fixture.ivars().committed.borrow(), "breakfast");
    assert_eq!(fixture.ivars().inserts.get(), 2);
    // The IDE policy disables automatic assistance, not an explicit local-English adoption.
    *fixture.ivars().bundle.borrow_mut() = "com.jetbrains.intellij".into();
    host::with(|h| {
        h.assistant.invalidate(true);
        h.engine.clear();
        assert!(h.apps.english_candidates_off("com.jetbrains.intellij"));
    });
    let before = fixture.ivars().inserts.get();
    for c in "yuanxing".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| h.session.candidate(i).is_some_and(|c| c.text == "圆形"))
            .expect("circle candidate")
    });
    controller.render(client);
    host::with(|h| {
        assert!(
            h.assistant.text.is_none(),
            "IDE should suppress automatic preview"
        )
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(&*fixture.ivars().committed.borrow(), "circle");
    assert_eq!(fixture.ivars().inserts.get(), before + 1);

    // A single explicit English key may wait, then adopt exactly once without a second key.
    host::with(|h| {
        h.assistant.invalidate(true);
        h.engine.set_input("ceshici");
        h.session.reset(
            Preedit::plain("ce'shi'ci", 9),
            vec![Candidate {
                text: "测试词".into(),
                kind: qingjian_core::CandidateKind::Generated,
                syllables: vec![],
                reading: None,
                translation: None,
                aux_code: None,
            }],
            h.page_size,
            0,
        );
    });
    client.set_marked_text("ce'shi'ci", 9);
    let before = fixture.ivars().inserts.get();
    event(" ", 49, NSEventModifierFlags::Option);
    host::with(|h| {
        assert_eq!(h.assistant.pending_adoption, Some(h.assistant.generation));
        h.assistant.text = Some("TestWord".into());
    });
    WordMateInputController::poll_adoption();
    assert_eq!(&*fixture.ivars().committed.borrow(), "TestWord");
    assert_eq!(fixture.ivars().inserts.get(), before + 1);
    WordMateInputController::poll_adoption();
    assert_eq!(fixture.ivars().inserts.get(), before + 1);

    host::with(|h| {
        h.assistant.invalidate(true);
        h.engine.set_input("ceshici");
        h.session.reset(
            Preedit::plain("ce'shi'ci", 9),
            vec![Candidate {
                text: "测试词".into(),
                kind: qingjian_core::CandidateKind::Generated,
                syllables: vec![],
                reading: None,
                translation: None,
                aux_code: None,
            }],
            h.page_size,
            0,
        );
    });
    client.set_marked_text("ce'shi'ci", 9);
    let before = fixture.ivars().inserts.get();
    event(" ", 49, NSEventModifierFlags::Option);
    event("e", 0, none);
    host::with(|h| {
        assert!(h.assistant.pending_adoption.is_none());
        h.assistant.text = Some("StaleResult".into());
    });
    WordMateInputController::poll_adoption();
    assert_eq!(
        fixture.ivars().inserts.get(),
        before,
        "continued editing must cancel automatic adoption"
    );
    event("", 53, none);

    *fixture.ivars().bundle.borrow_mut() = String::new();
    host::with(|h| {
        h.engine.clear();
        h.assistant.invalidate(true);
        h.assistant.set_edited_draft("娃问题".into(), 0);
    });
    controller.refresh(client);
    let before = fixture.ivars().inserts.get();
    for c in "xianzaicunzai".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        assert_eq!(h.engine.composition().typed_text(), "xianzaicunzai");
        assert_eq!(h.assistant.draft_text(), "娃问题");
    });
    let now = host::with(|h| {
        (0..h.session.layout.len())
            .find(|&i| h.session.candidate(i).is_some_and(|c| c.text == "现在"))
    })
    .flatten()
    .expect("pinyin candidate in the middle");
    controller.choose_candidate(now, client, false);
    host::with(|h| assert_eq!(h.engine.composition().typed_text(), "cunzai"));
    let exists = host::with(|h| {
        (0..h.session.layout.len())
            .find(|&i| h.session.candidate(i).is_some_and(|c| c.text == "存在"))
    })
    .flatten()
    .expect("remaining pinyin before preserved suffix");
    controller.choose_candidate(exists, client, false);
    assert_eq!(&*fixture.ivars().marked.borrow(), "现在存在娃问题");
    event("", 117, none);
    assert_eq!(&*fixture.ivars().marked.borrow(), "现在存在问题");
    assert_eq!(fixture.ivars().inserts.get(), before);
    for c in "bug".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.kind == qingjian_core::CandidateKind::English && c.text == "bug"
                })
            })
            .unwrap()
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(&*fixture.ivars().committed.borrow(), "现在存在bug问题");
    assert_eq!(fixture.ivars().inserts.get(), before + 1);

    // Mouse caret changes are respected on the next key, including Chinese insertion at the front.
    host::with(|h| {
        h.assistant.invalidate(true);
        h.assistant.set_edited_draft("存在问题".into(), 2);
    });
    controller.refresh(client);
    fixture.ivars().cursor.set(0);
    for c in "xianzai".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| h.session.candidate(i).is_some_and(|c| c.text == "现在"))
            .unwrap()
    });
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "现在存在问题");

    // Canceling new pinyin must keep the frozen words, not drop the suffix.
    host::with(|h| {
        h.assistant.invalidate(true);
        h.assistant.set_edited_draft("😀后文".into(), 1);
    });
    controller.refresh(client);
    for c in "xianzai".chars() {
        event(&c.to_string(), 0, none);
    }
    event("", 53, none);
    assert_eq!(&*fixture.ivars().marked.borrow(), "😀后文");
    host::with(|h| {
        h.engine.clear();
        h.assistant.draft.clear();
        h.assistant.draft_cursor = None;
        h.assistant.invalidate(true);
    });
    controller.refresh(client);

    // Confirming only part of a middle token keeps both unselected pinyin and the suffix.
    host::with(|h| {
        h.assistant.invalidate(true);
        h.assistant.set_edited_draft("后文".into(), 0);
    });
    controller.refresh(client);
    for c in "nihaoma".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.text == "你" && c.kind == qingjian_core::CandidateKind::Chinese
                })
            })
            .unwrap()
    });
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "你");
    assert!(fixture.ivars().marked.borrow().ends_with("后文"));
    host::with(|h| {
        assert_eq!(h.engine.composition().typed_text(), "haoma");
        assert_eq!(h.assistant.draft_text(), "后文");
        assert_eq!(h.assistant.draft_cursor, Some(0));
    });
    event("", 53, none);
    assert_eq!(&*fixture.ivars().marked.borrow(), "后文");
    host::with(|h| {
        h.engine.clear();
        h.assistant.draft.clear();
        h.assistant.draft_cursor = None;
        h.assistant.invalidate(true);
    });
    controller.refresh(client);

    // Wait for the asynchronous durable outbox, using only this fixture's isolated backend.
    let outbox =
        std::path::PathBuf::from(std::env::var_os("WM_USER_DATA").unwrap()).join("ime-outbox");
    let persisted = || {
        let events: Vec<serde_json::Value> = std::fs::read_dir(&outbox)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|file| std::fs::read(file.path()).ok())
            .filter_map(|data| serde_json::from_slice(&data).ok())
            .collect();
        events.iter().any(|e| {
            e["origin"] == "fragment"
                && e["adoptedExpression"] == "breakfast"
                && e["sourceMeaning"] == "早餐"
                && e["confirmed"] == true
        }) && events.iter().any(|e| {
            e["origin"] == "annotation"
                && e["adoptedExpression"] == "breakfast"
                && e["sourceMeaning"] == "早餐"
                && e["confirmed"] == true
        })
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !persisted() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        persisted(),
        "confirmed fragment/selection learning was not persisted"
    );
    // v0.6.0 English mode: test real dispatch, never bypass the Chinese binding priority.
    host::with(|h| {
        h.engine.clear();
        h.assistant.draft.clear();
        h.assistant.draft_cursor = None;
        h.end_translation();
    });
    *fixture.ivars().bundle.borrow_mut() = "com.apple.TextEdit".into();
    modifiers::set_english_mode(false);
    let toggle_flags = NSEventModifierFlags::Control | NSEventModifierFlags::Shift;
    event("E", 14, toggle_flags);
    assert!(modifiers::english_mode());
    fixture.ivars().writes.borrow_mut().clear();
    for c in "I".chars() {
        event(&c.to_string(), 0, none);
    }
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "I ");
    // Each word boundary is exactly one host write.
    for word in [
        "want",
        "to",
        "eat",
        "breakfast",
        "Diffu",
        "v2",
        "don't",
        "well-known",
    ] {
        for c in word.chars() {
            event(&c.to_string(), 0, none);
        }
        host::with(|h| {
            assert_eq!(h.engine.composition().typed_text(), word);
            assert!(h.engine.english_mode());
            assert!(!h.assistant.has_draft());
        });
        let inserts = fixture.ivars().inserts.get();
        event(" ", 49, none);
        assert_eq!(
            fixture.ivars().inserts.get(),
            inserts + 1,
            "one Space commits word and space, no extra key"
        );
        assert_eq!(&*fixture.ivars().committed.borrow(), &format!("{word} "));
        assert!(fixture.ivars().marked.borrow().is_empty());
    }
    assert_eq!(
        fixture.ivars().writes.borrow().concat(),
        "I want to eat breakfast Diffu v2 don't well-known "
    );
    event(" ", 49, none);
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), " ");
    for c in "bre".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session
                    .candidate(i)
                    .is_some_and(|c| c.text == "breakfast")
            })
            .expect("English completion breakfast");
    });
    event("\t", 48, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "breakfast");
    for c in "bre".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        h.session.highlighted = (0..h.session.layout.len())
            .find(|&i| {
                h.session
                    .candidate(i)
                    .is_some_and(|c| c.text == "breakfast")
            })
            .unwrap();
    });
    event(" ", 49, none);
    assert_eq!(
        &*fixture.ivars().committed.borrow(),
        "bre ",
        "Space must not silently take a completion"
    );
    for c in "foo123".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| assert_eq!(h.engine.composition().typed_text(), "foo123"));
    event("\r", 36, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "foo123");
    let returned = |characters: &str, code: u16, flags: NSEventModifierFlags| {
        let string = NSString::from_str(characters);
        let e = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            NSEventType::KeyDown, NSPoint::ZERO, flags, 0., 0, None, &string, &string, false, code).unwrap();
        controller.dispatch_event(&e, client)
    };
    assert!(
        !returned("\r", 36, none),
        "empty English Return is host action"
    );
    for c in "hello".chars() {
        event(&c.to_string(), 0, none);
    }
    assert!(!returned(".", 47, none));
    assert_eq!(&*fixture.ivars().committed.borrow(), "hello");
    for c in "ABC".chars() {
        event(&c.to_string(), 0, none);
    }
    assert!(
        !returned("", 123, none),
        "left arrow returns to the host for editing earlier words"
    );
    assert_eq!(&*fixture.ivars().committed.borrow(), "ABC");
    assert!(
        !returned("\t", 48, none),
        "empty Tab must keep host focus navigation"
    );
    event("E", 14, toggle_flags);
    assert!(!modifiers::english_mode());
    for c in "nihao".chars() {
        event(&c.to_string(), 0, none);
    }
    event(" ", 49, none);
    assert_eq!(
        &*fixture.ivars().committed.borrow(),
        "你好",
        "Chinese once-Space still works"
    );
    event("E", 14, toggle_flags);
    *fixture.ivars().bundle.borrow_mut() = "com.jetbrains.intellij".into();
    assert!(
        !returned("i", 34, none),
        "IDE English stays direct passthrough"
    );
    host::with(|h| assert!(h.engine.composition().is_empty()));
    *fixture.ivars().bundle.borrow_mut() = "com.apple.TextEdit".into();
    modifiers::set_english_mode(false);
    let shift_event = |code: u16, flags: NSEventModifierFlags| {
        let string = NSString::from_str("");
        let e = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            NSEventType::FlagsChanged, NSPoint::ZERO, flags, 0., 0, None, &string, &string, false, code).unwrap();
        controller.dispatch_event(&e, client);
    };
    shift_event(56, NSEventModifierFlags::Shift);
    shift_event(56, NSEventModifierFlags::Shift);
    assert!(
        !modifiers::english_mode(),
        "Shift down alone must not switch yet"
    );
    shift_event(56, none);
    assert!(
        modifiers::english_mode(),
        "Shift tap release switches to English"
    );
    shift_event(56, none);
    assert!(
        modifiers::english_mode(),
        "duplicate release must not toggle back"
    );
    shift_event(60, NSEventModifierFlags::Shift);
    event("A", 0, NSEventModifierFlags::Shift);
    shift_event(60, none);
    assert!(modifiers::english_mode(), "Shift+A must not switch mode");
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().committed.borrow(), "A ");
    shift_event(60, NSEventModifierFlags::Shift);
    shift_event(60, none);
    assert!(!modifiers::english_mode(), "Right Shift tap switches back");
    host::with(|h| {
        h.change_setting(
            crate::preferences::Setting::ShiftSwitch,
            crate::preferences::SettingValue::Bool(false),
        )
    });
    shift_event(56, NSEventModifierFlags::Shift);
    shift_event(56, none);
    assert!(
        !modifiers::english_mode(),
        "User disabled Shift switch must be respected"
    );
    host::with(|h| {
        h.change_setting(
            crate::preferences::Setting::ShiftSwitch,
            crate::preferences::SettingValue::Bool(true),
        )
    });
    // Exercise the Objective-C button activation entry points, not just a Rust helper.
    let mtm = objc2::MainThreadMarker::new().unwrap();
    let recorder = crate::preferences::KeyRecorder::new(mtm, false);
    recorder.show("control+shift+e", "Ctrl+Shift+E");
    let _: () = unsafe { msg_send![&*recorder, performClick: std::ptr::null::<AnyObject>()] };
    assert_eq!(recorder.title().to_string(), "按下新的快捷键…");
    let key = NSString::from_str("j");
    let e = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
        NSEventType::KeyDown, NSPoint::ZERO, NSEventModifierFlags::Control, 0., 0, None, &key, &key, false, 38).unwrap();
    let _: () = unsafe { msg_send![&*recorder, keyDown: &*e] };
    assert_eq!(recorder.recorded(), "control+j");
    let started: bool = unsafe { msg_send![&*recorder, accessibilityPerformPress] };
    assert!(started);
    assert_eq!(recorder.title().to_string(), "按下新的快捷键…");
    let esc = NSString::from_str("");
    let e = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
        NSEventType::KeyDown, NSPoint::ZERO, none, 0., 0, None, &esc, &esc, false, 53).unwrap();
    let _: () = unsafe { msg_send![&*recorder, keyDown: &*e] };
    assert_eq!(recorder.recorded(), "control+j");
    assert_ne!(recorder.title().to_string(), "按下新的快捷键…");
    modifiers::set_english_mode(false);
    host::with(|h| {
        h.window.hide();
        h.active_input = None;
    });
    println!(
        "IME_INTERACTION_OK dispatch Tab, mixed composition, original selection, caret editing, Option-Space adoption; one app insertion per adoption, highlighted candidate, selected-text adoption, Enter guard, confirmed fragment/selection learning, one-Space adoption, mixed-English source, candidate-window recovery, middle pinyin+suffix editing, IDE local gloss, queued single-key adoption/cancellation; English keyboard Space, Tab completion, case, digits, navigation, mode switching and IDE passthrough"
    );
}
