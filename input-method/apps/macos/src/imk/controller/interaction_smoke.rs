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
    cursor: Cell<usize>,
    selection_length: Cell<usize>,
    inserts: Cell<usize>,
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
        fn bundle(&self) -> Option<Retained<NSString>> { Some(NSString::from_str("org.wordmate.fixture")) }
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
    let allocated = WordMateInputController::alloc().set_ivars(());
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
    host::with(|h| {
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
    event(" ", 49, none);
    assert_eq!(&*fixture.ivars().marked.borrow(), "I want to eat 早餐");
    event("", 123, NSEventModifierFlags::Command);
    event("", 124, none);
    event("\t", 48, none);
    for c in "really".chars() {
        event(&c.to_string(), 0, none);
    }
    assert_eq!(
        &*fixture.ivars().marked.borrow(),
        "I really want to eat 早餐"
    );
    assert_eq!(fixture.ivars().inserts.get(), 0, "editing submitted to app");
    event("", 124, NSEventModifierFlags::Command);
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
    host::with(|h| {
        let job = h.translation.as_mut().expect("selection preview");
        assert!(!job.composition);
        assert_eq!(job.source, "早餐");
        job.result = Some("breakfast".into());
    });
    event(" ", 49, NSEventModifierFlags::Option);
    assert_eq!(&*fixture.ivars().committed.borrow(), "breakfast");
    assert_eq!(fixture.ivars().inserts.get(), 2);
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
    host::with(|h| {
        h.window.hide();
        h.active_input = None;
    });
    println!(
        "IME_INTERACTION_OK dispatch Tab, mixed composition, original selection, caret editing, Option-Space adoption; one app insertion per adoption, highlighted candidate, selected-text adoption, Enter guard, confirmed fragment/selection learning"
    );
}
