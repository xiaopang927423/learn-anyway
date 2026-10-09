use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
use objc2_foundation::NSString;
use std::path::PathBuf;

/// 弹系统的打开文件对话框选一个词库文件（TSV / Rime yaml / .qj）。用户取消返回 `None`。
/// 模态运行，只在偏好设置窗口打开时调用（那时进程已是 Accessory，能出对话框）。
pub fn choose_dictionary_files() -> Option<Vec<PathBuf>> {
    let mtm = MainThreadMarker::new()?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(true);
    panel.setMessage(Some(&NSString::from_str(
        "选择要导入的词库：WordMate 输入法 TSV、Rime .dict.yaml 或 .qj",
    )));
    panel.setPrompt(Some(&NSString::from_str("导入")));
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    Some(
        panel
            .URLs()
            .iter()
            .filter_map(|url| url.path().map(|p| PathBuf::from(p.to_string())))
            .collect(),
    )
}
pub fn choose_dictionary_file() -> Option<PathBuf> {
    choose_dictionary_files()?.into_iter().next()
}
