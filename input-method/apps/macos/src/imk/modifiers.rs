//! 当前修饰键状态。IMK 的 `inputText:client:` 不带事件对象，Caps Lock / Shift 只能从系统当前状态读。

use objc2_app_kit::{NSEvent, NSEventModifierFlags};

/// Caps Lock 亮着：视为英文模式，字母默认小写、按住 Shift 才大写、标点不转全角。
pub fn caps_lock_on() -> bool {
    NSEvent::modifierFlags_class().contains(NSEventModifierFlags::CapsLock)
}

/// Shift 正按着。读的是此刻的硬件状态而不是事件自带的标志，但 Shift 是按住不放的键，处理按键时它几乎总还按着。
/// macOS 上 Caps Lock 亮着时按住 Shift 送来的仍是大写（不像 Windows 会反转），所以英文模式的大小写只能靠它判断。
pub fn shift_down() -> bool {
    NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Shift)
}

thread_local! {
    static ENGLISH_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
    static LAST_CAPS: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}
/// Caps Lock changes override a previous software selection; menu polling also sees the change.
pub fn english_mode() -> bool {
    let caps = caps_lock_on();
    LAST_CAPS.with(|last| {
        if last
            .replace(Some(caps))
            .is_some_and(|previous| previous != caps)
        {
            ENGLISH_OVERRIDE.with(|mode| mode.set(None));
        }
    });
    ENGLISH_OVERRIDE.with(|mode| mode.get().unwrap_or(caps))
}
pub fn set_english_mode(english: bool) {
    LAST_CAPS.with(|last| last.set(Some(caps_lock_on())));
    ENGLISH_OVERRIDE.with(|mode| mode.set(Some(english)));
}
