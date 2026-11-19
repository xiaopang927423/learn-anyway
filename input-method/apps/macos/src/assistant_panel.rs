//! Nonactivating grammar review. Replacement requires an explicit verified action.
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSPanel, NSBackingStoreType, NSWindowStyleMask, NSWindowCollectionBehavior,
    NSView, NSScrollView, NSTextView, NSFont, NSButton, NSScreen, NSEvent, NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint, NSSize, NSRect, NSString};
use serde_json::Value;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct GrammarActions;
    impl GrammarActions {
        #[unsafe(method(adopt:))]
        fn adopt(&self, _sender: Option<&AnyObject>) {
            crate::imk::catch_panic("grammar adoption", crate::imk::WordMateInputController::apply_grammar);
        }
        #[unsafe(method(copy:))]
        fn copy(&self, _sender: Option<&AnyObject>) {
            if let Some(text) = crate::host::with(|h| h.grammar.result.as_ref().and_then(|r| r["grammar"]["corrected"].as_str().map(str::to_owned))).flatten() {
                let board = NSPasteboard::generalPasteboard();
                board.clearContents();
                unsafe { board.setString_forType(&NSString::from_str(&text), NSPasteboardTypeString); }
            }
        }
        #[unsafe(method(dismiss:))]
        fn dismiss(&self, _sender: Option<&AnyObject>) {
            crate::host::with(|h| { h.grammar.cancel(); h.assistant_panel.hide(); });
        }
    }
    unsafe impl NSObjectProtocol for GrammarActions {}
);

pub struct AssistantPanel {
    panel: Retained<NSPanel>,
    text: Retained<NSTextView>,
    _actions: Retained<GrammarActions>,
    mtm: MainThreadMarker,
}
impl AssistantPanel {
    pub fn new(mtm: MainThreadMarker) -> Self {
        let actions: Retained<GrammarActions> = unsafe { msg_send![mtm.alloc::<GrammarActions>(), init] };
        let size = NSSize::new(430., 310.);
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(mtm.alloc(), NSRect::new(NSPoint::ZERO,size),
            NSWindowStyleMask::Titled | NSWindowStyleMask::NonactivatingPanel, NSBackingStoreType::Buffered, false);
        panel.setTitle(&NSString::from_str("WordMate · 英文语法与表达"));
        panel.setHidesOnDeactivate(false); panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
        panel.setLevel(101);
        let view = NSView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::ZERO,size));
        let scroll = NSScrollView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::new(10.,50.),NSSize::new(410.,250.)));
        scroll.setHasVerticalScroller(true);
        let text = NSTextView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::ZERO,NSSize::new(390.,250.)));
        text.setRichText(false); text.setEditable(false); text.setSelectable(true);
        text.setVerticallyResizable(true); text.setHorizontallyResizable(false);
        text.setFont(Some(&NSFont::systemFontOfSize(14.)));
        scroll.setDocumentView(Some(&text)); view.addSubview(&scroll);
        for (title, action, x, width) in [("采用修正",sel!(adopt:),10.,120.),("复制修正",sel!(copy:),140.,120.),("关闭",sel!(dismiss:),320.,90.)] {
            let button = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(title),Some(&*actions),Some(action),mtm) };
            button.setFrame(NSRect::new(NSPoint::new(x,10.),NSSize::new(width,30.))); view.addSubview(&button);
        }
        panel.setContentView(Some(&view));
        Self { panel, text, _actions: actions, mtm }
    }
    pub fn hide(&self) { if self.panel.isVisible() { self.panel.orderOut(None); } }
    pub fn show_review(&self, result: &Value, anchor: NSRect) {
        let g = &result["grammar"];
        let mut text = format!("{}\n\n修正后：\n{}\n\n",g["summary"].as_str().unwrap_or("英文表达提示"),g["corrected"].as_str().unwrap_or_default());
        if let Some(issues) = g["issues"].as_array() {
            for (i, issue) in issues.iter().enumerate() {
                text.push_str(&format!("{}. {}\n「{}」 → 「{}」\n{}\n\n",i+1,
                    if issue["severity"] == "error" { "需要修正" } else { "可选表达建议" },
                    issue["original"].as_str().unwrap_or_default(),issue["replacement"].as_str().unwrap_or_default(),issue["explanation"].as_str().unwrap_or_default()));
            }
        }
        self.text.setString(&NSString::from_str(&text));
        let point = if anchor == NSRect::ZERO { NSEvent::mouseLocation() } else { anchor.origin };
        let screen = NSScreen::screens(self.mtm).iter().find(|s| {
            let r=s.frame(); point.x>=r.origin.x && point.x<r.origin.x+r.size.width && point.y>=r.origin.y && point.y<r.origin.y+r.size.height
        }).map(|s| s.visibleFrame());
        let mut origin = NSPoint::new(point.x, point.y - 350.);
        if let Some(r) = screen {
            origin.x = origin.x.clamp(r.origin.x, (r.origin.x+r.size.width-430.).max(r.origin.x));
            origin.y = origin.y.clamp(r.origin.y, (r.origin.y+r.size.height-340.).max(r.origin.y));
        }
        self.panel.setFrameOrigin(origin); self.panel.orderFrontRegardless();
    }
}
