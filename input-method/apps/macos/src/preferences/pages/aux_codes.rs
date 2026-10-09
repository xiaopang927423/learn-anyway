//! 「词库」页：导入按钮，加一个可滚动的列表，每本一行（勾选框开关 + 非随包的「移除」）。

use std::cell::RefCell;

use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::{NSScrollView, NSTextField, NSView};
use objc2_foundation::{NSPoint, NSRect, NSSize};

use crate::host::DictionaryInfo;
use crate::preferences::controls::{
    GROUP_GAP, NOTE_HEIGHT, button, checkbox, note_full, set_checked, small_label,
};
use crate::preferences::layout::{Layout, PAGE_PADDING, PAGE_WIDTH, ROW_HEIGHT};
use crate::preferences::setting::Setting;
use crate::preferences::target::PreferencesTarget;

/// 列表里一行的高度。
const ROW: f64 = ROW_HEIGHT + 6.0;

/// 列表区的最小高度（约放得下 8 本）；窗口更高时撑到页底，装不下的滚。
const LIST_HEIGHT: f64 = 10.0 * ROW;

pub struct AuxCodesPage {
    /// 列表的文档视图，行都加在它上面。
    enabled: Retained<objc2_app_kit::NSButton>,
    show: Retained<objc2_app_kit::NSButton>,
    keep: Retained<objc2_app_kit::NSButton>,
    key: Retained<NSTextField>,
    list: Retained<NSView>,

    /// 装列表的滚动视图。
    scroll: Retained<NSScrollView>,

    /// 当前的行控件，重建时先移除。
    rows: RefCell<Vec<Retained<NSView>>>,

    /// 一本都没有时的提示。
    empty: Retained<NSTextField>,

    /// 行控件的 target；建行时用。
    target: Retained<PreferencesTarget>,

    mtm: MainThreadMarker,
}

impl AuxCodesPage {
    pub fn build(
        layout: &mut Layout,
        mtm: MainThreadMarker,
        target: &Retained<PreferencesTarget>,
    ) -> Self {
        let enabled = checkbox(mtm, "启用辅码", Setting::AuxEnabled, target);
        super::super::controls::row_checkbox(layout, &enabled);
        let show = checkbox(mtm, "候选显示码", Setting::AuxShow, target);
        super::super::controls::row_checkbox(layout, &show);
        let keep = checkbox(mtm, "删空码后保留辅码状态", Setting::AuxKeep, target);
        super::super::controls::row_checkbox(layout, &keep);
        let key = super::super::controls::text_field(mtm, Setting::AuxKey, target);
        super::super::controls::row_control(layout, mtm, "触发键", &key);
        let import = button(mtm, "导入辅码表…", Setting::ImportAuxCode, target);
        layout.place(&import, PAGE_PADDING, 140.0, ROW_HEIGHT + 4.0);
        layout.next_row(ROW_HEIGHT + 4.0);
        note_full(
            layout,
            mtm,
            "导入 Rime .dict.yaml 或辅码 .qj；下方可单独启停。移除用户表移至 codes/removed，随包表不可移除。",
        );
        layout.space(GROUP_GAP);
        let list = NSView::initWithFrame(mtm.alloc(), NSRect::ZERO);
        // 列表放在滚动视图里：随包 11 本加导入的可能超过一屏，全部列出、可以滚，不再只显示前几本
        let scroll = NSScrollView::initWithFrame(mtm.alloc(), NSRect::ZERO);
        scroll.setHasVerticalScroller(true);
        scroll.setDrawsBackground(false);
        scroll.setDocumentView(Some(&list));
        layout.place_fill(&scroll, PAGE_PADDING, layout.inner_width(), LIST_HEIGHT);
        layout.next_row(LIST_HEIGHT);
        let empty = small_label(mtm, "没有可用辅码表，触发键保持正常标点。");
        list.addSubview(&empty);
        empty.setFrame(NSRect::new(
            NSPoint::new(0.0, LIST_HEIGHT - NOTE_HEIGHT),
            NSSize::new(PAGE_WIDTH - 2.0 * PAGE_PADDING, NOTE_HEIGHT),
        ));
        Self {
            enabled,
            show,
            keep,
            key,
            list,
            scroll,
            rows: RefCell::new(Vec::new()),
            empty,
            target: target.clone(),
            mtm,
        }
    }

    pub fn sync(&self, config: &qingjian_platform::Config) {
        set_checked(&self.enabled, config.aux_code.enabled);
        set_checked(&self.show, config.general.aux_code_show);
        set_checked(&self.keep, config.general.aux_code_keep_empty);
        self.key
            .setStringValue(&objc2_foundation::NSString::from_str(
                &config.general.aux_code_key,
            ));
        self.rebuild(&crate::host::auxiliary_infos(config));
    }
    /// 按当前词库清单重建列表：每本一行，勾选框（名字 · 条数 · 许可证）+「移除」按钮。
    pub fn rebuild(&self, dictionaries: &[DictionaryInfo]) {
        let mtm = self.mtm;
        for view in self.rows.borrow_mut().drain(..) {
            view.removeFromSuperview();
        }
        self.empty.setHidden(!dictionaries.is_empty());
        let width = PAGE_WIDTH - 2.0 * PAGE_PADDING;
        // 文档视图按行数撑高（至少一屏），行从顶部往下排；滚动条要留出位置
        let visible_height = self.scroll.contentSize().height.max(LIST_HEIGHT);
        let document_height = (ROW * dictionaries.len() as f64).max(visible_height);
        let content_width = self.scroll.contentSize().width.min(width);
        self.list.setFrame(NSRect::new(
            NSPoint::ZERO,
            NSSize::new(content_width, document_height),
        ));
        self.empty.setFrame(NSRect::new(
            NSPoint::new(0.0, document_height - NOTE_HEIGHT),
            NSSize::new(content_width, NOTE_HEIGHT),
        ));
        let width = content_width;
        let mut rows = self.rows.borrow_mut();
        for (index, info) in dictionaries.iter().enumerate() {
            let y = document_height - ROW * (index as f64 + 1.0);
            let mut title = info.name.clone();
            if info.broken {
                title.push_str("（文件损坏）");
            } else {
                title.push_str(&format!(" · {} 条", info.entries));
                if info.builtin {
                    title.push_str(" · 随包");
                } else if !info.license.is_empty() {
                    title.push_str(&format!(" · {}", info.license));
                }
            }
            let toggle = checkbox(mtm, &title, Setting::AuxTableEnabled(index), &self.target);
            set_checked(&toggle, info.enabled);
            toggle.setEnabled(!info.broken);
            toggle.setFrame(NSRect::new(
                NSPoint::new(0.0, y),
                NSSize::new(width - 80.0, ROW),
            ));
            self.list.addSubview(&toggle);
            rows.push(Retained::into_super(Retained::into_super(toggle)));
            // 随包词库只能开关，不能移除
            if !info.builtin {
                let remove = button(mtm, "移除", Setting::AuxTableRemove(index), &self.target);
                remove.setFrame(NSRect::new(
                    NSPoint::new(width - 72.0, y + 1.0),
                    NSSize::new(72.0, ROW - 2.0),
                ));
                self.list.addSubview(&remove);
                rows.push(Retained::into_super(Retained::into_super(remove)));
            }
        }
        // 非翻转坐标系的文档视图默认停在底部，滚回顶部让第一本在最上面
        let clip = self.scroll.contentView();
        clip.scrollToPoint(NSPoint::new(
            0.0,
            document_height - clip.bounds().size.height,
        ));
        self.scroll.reflectScrolledClipView(&clip);
    }
}
