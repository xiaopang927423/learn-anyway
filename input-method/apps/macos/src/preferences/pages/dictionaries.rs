//! Local, online, and personal dictionaries in one settings page.
use crate::host::DictionaryInfo;
use crate::preferences::controls::{
    button, checkbox, note_full, row_checkbox, set_checked, small_label,
};
use crate::preferences::layout::{Layout, PAGE_PADDING, PAGE_WIDTH, ROW_HEIGHT};
use crate::preferences::setting::Setting;
use crate::preferences::target::PreferencesTarget;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::{NSButton, NSScrollView, NSTextField, NSView};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use qingjian_platform::Config;
use std::cell::RefCell;
const ROW: f64 = 54.0;
const LIST_HEIGHT: f64 = 6.0 * ROW;
pub struct DictionariesPage {
    list: Retained<NSView>,
    scroll: Retained<NSScrollView>,
    rows: RefCell<Vec<Retained<NSView>>>,
    shown: RefCell<Vec<DictionaryInfo>>,
    actions: RefCell<Vec<Retained<NSButton>>>,
    check: Retained<NSButton>,
    update: Retained<NSButton>,
    auto: Retained<NSButton>,
    learning: Retained<NSButton>,
    memory: Retained<NSTextField>,
    status: Retained<NSTextField>,
    target: Retained<PreferencesTarget>,
    mtm: MainThreadMarker,
}
impl DictionariesPage {
    pub fn build(
        layout: &mut Layout,
        mtm: MainThreadMarker,
        target: &Retained<PreferencesTarget>,
    ) -> Self {
        let check = button(mtm, "检查词库更新", Setting::DictionaryCheck, target);
        let update = button(
            mtm,
            "更新已启用词库",
            Setting::DictionaryUpdateEnabled,
            target,
        );
        let import = button(mtm, "导入词库…", Setting::ImportDictionary, target);
        layout.place(&check, PAGE_PADDING, 150.0, ROW_HEIGHT + 4.0);
        layout.place(&update, PAGE_PADDING + 158.0, 170.0, ROW_HEIGHT + 4.0);
        layout.place(&import, PAGE_PADDING + 336.0, 140.0, ROW_HEIGHT + 4.0);
        layout.next_row(ROW_HEIGHT + 4.0);
        let auto = checkbox(
            mtm,
            "每天自动检查并更新已启用词库",
            Setting::DictionaryAutoUpdate,
            target,
        );
        row_checkbox(layout, &auto);
        let learning = checkbox(
            mtm,
            "记住我的选词习惯、人名和常用短语",
            Setting::Learning,
            target,
        );
        row_checkbox(layout, &learning);
        let memory = small_label(mtm, "个人记忆保存在本机，联网更新不会覆盖，也不会上传。");
        layout.place(&memory, PAGE_PADDING, layout.inner_width(), 22.0);
        layout.next_row(22.0);
        let status = small_label(mtm, "尚未联网检查");
        layout.place(&status, PAGE_PADDING, layout.inner_width(), 22.0);
        layout.next_row(22.0);
        note_full(
            layout,
            mtm,
            "词库来源：Qingjian 官方 GitHub / Gitee。下载后自动启用，更新在本轮输入结束后生效。通用扩展词库较大，部分读音仍待校对，请按需下载。也可导入 TSV、Rime .dict.yaml、.qj。",
        );
        let list = NSView::initWithFrame(mtm.alloc(), NSRect::ZERO);
        let scroll = NSScrollView::initWithFrame(mtm.alloc(), NSRect::ZERO);
        scroll.setHasVerticalScroller(true);
        scroll.setDrawsBackground(false);
        scroll.setDocumentView(Some(&list));
        layout.place_fill(&scroll, PAGE_PADDING, layout.inner_width(), LIST_HEIGHT);
        layout.next_row(LIST_HEIGHT);
        Self {
            list,
            scroll,
            rows: RefCell::new(Vec::new()),
            shown: RefCell::new(Vec::new()),
            actions: RefCell::new(Vec::new()),
            check,
            update,
            auto,
            learning,
            memory,
            status,
            target: target.clone(),
            mtm,
        }
    }
    pub fn sync(
        &self,
        config: &Config,
        dictionaries: &[DictionaryInfo],
        status: &str,
        busy: bool,
        words: usize,
    ) {
        self.rebuild(dictionaries);
        set_checked(&self.auto, config.dictionaries.auto_update);
        set_checked(&self.learning, config.general.learning);
        self.memory.setStringValue(&NSString::from_str(&format!(
            "个人记忆：{words} 个词 / 短语 · 本机保存 · 不上传 · 更新不会覆盖"
        )));
        self.status.setStringValue(&NSString::from_str(status));
        self.status.setToolTip(Some(&NSString::from_str(status)));
        self.check.setEnabled(!busy);
        self.update.setEnabled(!busy);
        for button in self.actions.borrow().iter() {
            button.setEnabled(!busy);
        }
    }
    pub fn rebuild(&self, dictionaries: &[DictionaryInfo]) {
        if *self.shown.borrow() == dictionaries {
            return;
        }
        *self.shown.borrow_mut() = dictionaries.to_vec();
        let old_top = self.list.frame().size.height - self.scroll.contentView().bounds().origin.y;
        for view in self.rows.borrow_mut().drain(..) {
            view.removeFromSuperview();
        }
        self.actions.borrow_mut().clear();
        let height = (ROW * dictionaries.len() as f64)
            .max(self.scroll.contentSize().height.max(LIST_HEIGHT));
        let width = self
            .scroll
            .contentSize()
            .width
            .min(PAGE_WIDTH - 2.0 * PAGE_PADDING);
        self.list
            .setFrame(NSRect::new(NSPoint::ZERO, NSSize::new(width, height)));
        let mut rows = self.rows.borrow_mut();
        for (index, info) in dictionaries.iter().take(100).enumerate() {
            let y = height - ROW * (index as f64 + 1.0);
            let suffix = if info.broken {
                " · 未安装或不可用".into()
            } else {
                format!(
                    " · {} 条 · {}",
                    info.entries,
                    if info.enabled {
                        "已启用"
                    } else {
                        "未启用"
                    }
                )
            };
            let toggle = checkbox(
                self.mtm,
                &format!("{}{}", info.name, suffix),
                Setting::DictionaryEnabled(index),
                &self.target,
            );
            set_checked(&toggle, info.enabled);
            toggle.setEnabled(!info.broken);
            toggle.setFrame(NSRect::new(
                NSPoint::new(0.0, y + 24.0),
                NSSize::new(width - 108.0, 28.0),
            ));
            self.list.addSubview(&toggle);
            rows.push(Retained::into_super(Retained::into_super(toggle)));
            let detail = if info.detail.is_empty() {
                if info.builtin {
                    "随包词库"
                } else {
                    &info.license
                }
            } else {
                &info.detail
            };
            let label = small_label(self.mtm, detail);
            label.setFrame(NSRect::new(
                NSPoint::new(22.0, y + 2.0),
                NSSize::new(width - 30.0, 20.0),
            ));
            label.setToolTip(Some(&NSString::from_str(detail)));
            self.list.addSubview(&label);
            rows.push(Retained::into_super(Retained::into_super(label)));
            let action = if info.download_id.is_some() {
                Some(button(
                    self.mtm,
                    &info.download_label,
                    Setting::DictionaryDownload(index),
                    &self.target,
                ))
            } else if !info.builtin {
                Some(button(
                    self.mtm,
                    "移除",
                    Setting::DictionaryRemove(index),
                    &self.target,
                ))
            } else {
                None
            };
            if let Some(action) = action {
                action.setFrame(NSRect::new(
                    NSPoint::new(width - 102.0, y + 25.0),
                    NSSize::new(100.0, 26.0),
                ));
                self.list.addSubview(&action);
                if info.download_label == "需升级输入法" {
                    action.setEnabled(false);
                } else {
                    self.actions.borrow_mut().push(action.clone());
                }
                rows.push(Retained::into_super(Retained::into_super(action)));
            }
        }
        let clip = self.scroll.contentView();
        let top = if old_top > 0.0 {
            old_top
        } else {
            clip.bounds().size.height
        };
        clip.scrollToPoint(NSPoint::new(
            0.0,
            (height - top)
                .max(0.0)
                .min((height - clip.bounds().size.height).max(0.0)),
        ));
        self.scroll.reflectScrolledClipView(&clip);
    }
}
