//! Selection/paging regressions through real NSEvents and an isolated mock IMK client.
use super::*;
use std::time::{Duration, Instant};

fn reset(controller: &WordMateInputController, fixture: &FixtureClient) {
    modifiers::set_english_mode(false);
    host::with(|h| {
        h.engine.clear();
        h.engine.set_english_mode(false);
        h.engine.set_async_sentence_scorer(None);
        h.engine.set_predictor(Box::new(qingjian_core::NoPredictor));
        h.assistant.invalidate(true);
        h.assistant.draft.clear();
        h.assistant.draft_cursor = None;
        h.assistant.context.clear();
        h.end_translation();
        h.page_size = 5;
        h.page_keys = ('[', ']');
        h.cloud_slots = 0;
        h.horizontal_grid = false;
        h.layout = qingjian_platform::LayoutMode::Vertical;
    });
    fixture.ivars().committed.borrow_mut().clear();
    fixture.ivars().marked.borrow_mut().clear();
    fixture.ivars().cursor.set(0);
    controller.refresh(TextClient::new(fixture));
}

pub(super) fn run(controller: &WordMateInputController, fixture: &FixtureClient) {
    let client = TextClient::new(fixture);
    let none = NSEventModifierFlags::empty();
    let event = |text: &str, code, flags| {
        let text = NSString::from_str(text);
        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            NSEventType::KeyDown, NSPoint::ZERO, flags, 0., 0, None, &text, &text, false, code).unwrap();
        assert!(
            controller.dispatch_event(&event, client),
            "navigation key {code} escaped"
        );
    };
    let page = || host::with(|h| h.session.page).unwrap();
    let selected =
        || host::with(|h| h.session.candidate(h.session.highlighted).unwrap().text).unwrap();

    reset(controller, fixture);
    for c in "shi".chars() {
        event(&c.to_string(), 0, none);
    }
    let first = selected();
    let before = fixture.ivars().inserts.get();
    event("]", 30, none);
    assert_eq!(page(), 1);
    let second = selected();
    assert_ne!(first, second);
    event("[", 33, none);
    assert_eq!(page(), 0);
    assert_eq!(selected(), first);
    event("", 121, none);
    assert_eq!(selected(), second);
    event("\t", 48, NSEventModifierFlags::Shift);
    assert_eq!(page(), 0);
    assert_eq!(
        fixture.ivars().inserts.get(),
        before,
        "paging submitted text"
    );
    event("", 121, none);
    let expected = host::with(|h| {
        h.session
            .candidate(h.session.index_on_page(1).unwrap())
            .unwrap()
            .text
    })
    .unwrap();
    event("", 84, none);
    assert_eq!(
        *fixture.ivars().committed.borrow(),
        expected,
        "digit must select the displayed page"
    );
    assert_eq!(fixture.ivars().inserts.get(), before + 1);

    // Click indices use the same page offset as numeric selection.
    reset(controller, fixture);
    for c in "shi".chars() {
        event(&c.to_string(), 0, none);
    }
    event("]", 30, none);
    let (index, expected) = host::with(|h| {
        let index = h.session.index_on_page(2).unwrap();
        (index, h.session.candidate(index).unwrap().text)
    })
    .unwrap();
    controller.choose_candidate(index, client, false);
    assert_eq!(*fixture.ivars().committed.borrow(), expected);

    reset(controller, fixture);
    for c in "shi".chars() {
        event(&c.to_string(), 0, none);
    }
    controller.turn_page(10000, client);
    let last = (page(), selected());
    event("]", 30, none);
    assert_eq!((page(), selected()), last, "last page must clamp");
    assert_eq!(
        host::with(|h| h.engine.composition().typed_text()).unwrap(),
        "shi"
    );

    // An attempted navigation at the first row still freezes a newly expanded grid.
    reset(controller, fixture);
    host::with(|h| {
        h.horizontal_grid = true;
        h.layout = qingjian_platform::LayoutMode::Horizontal;
    });
    for c in "shi".chars() {
        event(&c.to_string(), 0, none);
    }
    event("", 126, none);
    host::with(|h| {
        assert!(h.session.grid.is_some());
        assert!(
            h.session.navigated,
            "opening a grid must lock candidate positions"
        );
    });
    event("", 125, none);
    assert_eq!(page(), 1);
    event("", 123, none);
    assert_eq!(page(), 0);
    let expected = host::with(|h| h.session.candidate(1).unwrap().text).unwrap();
    event("2", 19, none);
    assert_eq!(*fixture.ivars().committed.borrow(), expected);

    reset(controller, fixture);
    modifiers::set_english_mode(true);
    host::with(|h| h.english_candidates = true);
    for c in "de".chars() {
        event(&c.to_string(), 0, none);
    }
    let before = fixture.ivars().inserts.get();
    event("", 121, none);
    assert_eq!(page(), 1, "English PageDown must navigate candidates");
    event("", 116, none);
    assert_eq!(page(), 0);
    event("", 121, none);
    event("\t", 48, NSEventModifierFlags::Shift);
    assert_eq!(page(), 0);
    assert_eq!(
        fixture.ivars().inserts.get(),
        before,
        "English paging submitted raw input"
    );
    event("", 121, none);
    event("", 18, none);
    event(" ", 49, none);
    assert_eq!(*fixture.ivars().committed.borrow(), "de1 ");
    for c in "de".chars() { event(&c.to_string(), 0, none); }
    assert!(controller.handle_text("2", client));
    event(" ", 49, none);
    assert_eq!(*fixture.ivars().committed.borrow(), "de2 ");

    // Chrome/Electron IMK events can omit characters. Explicit insertion must
    // work in both modes for every top-row and keypad digit, including zero.
    for english in [false, true] {
        reset(controller, fixture);
        modifiers::set_english_mode(english);
        for (digit, key, pad) in [(0,29,82),(1,18,83),(2,19,84),(3,20,85),(4,21,86),(5,23,87),(6,22,88),(7,26,89),(8,28,91),(9,25,92)] {
            for key in [key, pad] {
                let before = fixture.ivars().inserts.get();
                event("", key, none);
                assert_eq!(*fixture.ivars().committed.borrow(), digit.to_string());
                assert_eq!(fixture.ivars().inserts.get(), before + 1);
            }
        }
    }

    // Draft editor page keys must not freeze the pending token and insert brackets.
    reset(controller, fixture);
    host::with(|h| {
        h.assistant.set_edited_draft("前后".into(), 1);
        h.engine.set_input("shi");
    });
    controller.refresh(client);
    let before = fixture.ivars().inserts.get();
    event("]", 30, none);
    assert_eq!(page(), 1);
    host::with(|h| {
        assert_eq!(h.assistant.draft_text(), "前后");
        assert_eq!(h.engine.composition().typed_text(), "shi");
    });
    let expected = host::with(|h| {
        h.assistant.composition_text(
            &h.session
                .candidate(h.session.index_on_page(1).unwrap())
                .unwrap()
                .text,
        )
    })
    .unwrap();
    event("2", 19, none);
    assert_eq!(*fixture.ivars().committed.borrow(), expected);
    assert_eq!(fixture.ivars().inserts.get(), before + 1);

    reset(controller, fixture);
    for c in "no-way".chars() {
        event(&c.to_string(), 0, none);
    }
    event("", 18, none);
    assert_eq!(
        *fixture.ivars().committed.borrow(),
        "no-way",
        "raw candidate number remains selectable"
    );

    reset(controller, fixture);
    let before = fixture.ivars().inserts.get();
    for c in "v2+3".chars() {
        event(&c.to_string(), 0, none);
    }
    host::with(|h| {
        assert!(h.engine.expression_mode());
        assert_eq!(h.engine.composition().typed_text(), "v2+3");
    });
    assert_eq!(
        fixture.ivars().inserts.get(),
        before,
        "calculator digits must not select candidates"
    );

    // A literal candidate at a middle caret must consume exactly the text it displays.
    for (input, literal, remaining) in [("nihaoma", "ni", "haoma"), ("NiHaoma", "Ni", "Haoma")] {
        reset(controller, fixture);
        host::with(|h| {
            h.engine.set_input(input);
            for _ in 0..5 {
                h.engine.move_cursor_left();
            }
        });
        controller.refresh(client);
        let index = host::with(|h| {
            (0..h.session.layout.len()).find(|&i| {
                h.session.candidate(i).is_some_and(|c| {
                    c.kind == qingjian_core::CandidateKind::English && c.text == literal
                })
            })
        })
        .flatten()
        .unwrap_or_else(|| {
            panic!(
                "scope-only literal candidate {input}/{literal}: {:?}",
                host::with(|h| h
                    .session
                    .layout
                    .local()
                    .iter()
                    .map(|c| (&c.kind, &c.text))
                    .map(|(k, t)| format!("{k:?}:{t}"))
                    .collect::<Vec<_>>())
                .unwrap()
            )
        });
        controller.commit_number(index, client);
        assert_eq!(*fixture.ivars().committed.borrow(), literal);
        assert_eq!(
            host::with(|h| h.engine.composition().typed_text()).unwrap(),
            remaining
        );
    }

    // Exercise the actual asynchronous callback, with a deterministic fake scorer.
    struct Scorer;
    impl qingjian_core::sentence::SentenceScorer for Scorer {
        fn score(&self, _: &str, _: &str, texts: &[&str]) -> Vec<f64> {
            vec![-1.; texts.len()]
        }
    }
    for editor in [false, true] {
        reset(controller, fixture);
        host::with(|h| {
            h.engine.set_async_sentence_scorer(Some(Box::new(Scorer)));
            h.assistant.set_edited_draft("we ".into(), 3);
            if !editor {
                h.assistant.draft_cursor = None;
            }
            h.engine.set_input("nihao");
        });
        controller.refresh(client);
        let marked = fixture.ivars().marked.borrow().clone();
        let (preedit, cursor, literal_index) = host::with(|h| {
            let p = h.session.preedit.as_ref().unwrap();
            let literal = h
                .session
                .layout
                .local()
                .iter()
                .position(|c| c.text == "nihao")
                .unwrap();
            let saved = (p.text(), p.cursor, literal);
            let mut items = h.session.layout.local().to_vec();
            items.push(Candidate {
                text: "callback-sentinel".into(),
                ..items[0].clone()
            });
            h.reset_session(h.session.preedit.clone(), items);
            assert!(
                h.engine.rescoring_pending(),
                "fixture needs a real pending rescore"
            );
            h.start_rescoring();
            saved
        })
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let applied = host::with(|h| {
                h.poll_rescoring();
                !h.session
                    .layout
                    .local()
                    .iter()
                    .any(|c| c.text == "callback-sentinel")
            })
            .unwrap();
            if applied {
                break;
            }
            assert!(Instant::now() < deadline, "rescore callback did not apply");
            std::thread::sleep(Duration::from_millis(5));
        }
        host::with(|h| {
            let p = h.session.preedit.as_ref().unwrap();
            assert_eq!(
                (p.text(), p.cursor),
                (preedit, cursor),
                "rescore lost the draft/caret"
            );
            assert_eq!(
                h.session.layout.local()[literal_index].text,
                "nihao",
                "rescore removed or moved the literal slot"
            );
        });
        assert_eq!(*fixture.ivars().marked.borrow(), marked);
    }
    reset(controller, fixture);
    println!(
        "IME_NAVIGATION_OK Chinese paging/digits/click, page boundaries, grid, English paging/Tab, scoped literals, asynchronous draft/literal preservation (mock scorer and IMK)"
    );
}
