//! Translation is rendered inside its candidate row; no second floating window.
use objc2::MainThreadMarker;
pub struct AssistantPanel;
impl AssistantPanel {
    pub fn new(_mtm: MainThreadMarker) -> Self {
        Self
    }
    pub fn hide(&self) {}
}
