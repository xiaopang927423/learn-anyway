# WordMate 输入法开发组件

v0.5.0 本地开发版，macOS arm64。Rust 基础引擎和原生壳来自 Qingjian c08ae57；来源、GPL-3.0-or-later 和资源声明见 [NOTICE](NOTICE.md)、[资源来源](UPSTREAM-DATA-SOURCES.md)。桌面端原有 MIT 声明不覆盖本组件。

## 构建、打包和安装

从仓库根运行：

```sh
python3 input-method/scripts/build.py --reference /Users/qiji/Desktop/AI-Study/qingjian
python3 input-method/scripts/package.py
python3 input-method/scripts/install.py
```

资源经 resource-manifest.json 验证。`--release` 只选择优化构建；不代表发布验收通过。资源和构建产物不进入 Git。

安装包：`input-method/dist/WordMateInput-0.5.0-dev-local.pkg`。使用 macOS Installer 的 CurrentUserHomeDirectory 域，安装至 `~/Library/Input Methods/WordMateInput.app`，不复制至系统目录。替换前停止确切旧进程并备份至 `~/Library/Application Support/WordMateInput/install-backups/`；学习数据位于应用支持目录。

安装文件与输入源启用是两个状态。安装后检查：

```sh
"$HOME/Library/Input Methods/WordMateInput.app/Contents/MacOS/WordMateInput" --registration-status
```

`ready` 仅表示父输入法和子模式均启用；实际键入需另行验收。`install.py` 在启用失败时退出码为 2，不宣称可用。`--select` 只在启用检查通过后选择并回读当前输入源。安装器记录 `install-state.json`；首次安装后系统未刷新时，保存工作、注销并重新登录，再从系统设置添加 / 选择 WordMate 输入法。该刷新步骤仍需本机验证。

2026-10-08 本机安装文件成功；离线候选、桌面 RPC 已通过。系统父输入法持续未启用，用户自己的终端复现，真实系统输入仍未验收。没有 Developer ID 证书；本地包使用 ad-hoc 签名，不作为已签名 / 公证的发行包。

## 使用边界

普通输入与词库离线可用；云辅助在 WordMate 设置里开启，复用已有模型和 Thinking 设置。Space 一次采用当前候选（包含混输英文），Option+Space 选英文，Tab 输入空格，四项输入快捷键可自定义；Option+数字沿用基础译词操作。片段预览不入词本，确认写入后的英语采用才产生学习事件；无法确认时保留可复制结果。

配置和习惯：`~/Library/Application Support/WordMateInput/`。桥接：WordMate 的 `ime.sock` 与私有 `ime-token`。`WM_IME_DATA`、`WM_USER_DATA` 用于隔离开发测试；不读取全局剪贴板内容。开发测试与实际应用验证分别记录。

代码与验收状态见 [v0.5.0 实施记录](../docs/测试目录/v0.5.0-实施记录.md)。安装失败时不应反复更换 bundle ID、重置其他输入法或修改系统安全设置。

## 2026-10-09 更新

已安装的新组件使用同一候选窗口的句下译文，原独立辅助窗口已移除。普通中文选词即时上屏；Tab 将英文词及空格保留在黑框草稿，混输中文可选入同一句，支持草稿前文编辑和整句确认翻译。英文混输入与空间边界已补充内核 / 真实模型验证。系统输入源当前已启用。操作见 [清单](../docs/测试目录/v0.5.0-操作清单.md)，确认方案见 [ADR-004](../docs/架构目录/ADR-004-选字与语言确认分离.md)。

控制器回归：在隔离目录运行 `WM_IME_DATA=/tmp/wm-ime-test WM_USER_DATA=/tmp/wm-bridge-test bundle/WordMateInput.app/Contents/MacOS/WordMateInput --interaction-smoke`。使用 NSEvent 和模拟 IMK 文本客户端验证实际分发，不依赖真实模型，不代表所有宿主应用已验收。

2026-10-10：修正 Space 先暂存导致需按两次的问题；短候选保留未选拼音；补可选原文与空会话恢复。通用页可开关自动记忆，常用词条页可手工新增/纠正，个人词库保存后参与候选。
