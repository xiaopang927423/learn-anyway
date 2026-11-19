# WordMate 输入法开发组件

v0.6.4 / build 6040 实验性本地开发版（仍有已知 bug），macOS arm64。Rust 基础引擎和原生壳来自 Qingjian c08ae57；来源、GPL-3.0-or-later 和资源声明见 [NOTICE](NOTICE.md)、[资源来源](UPSTREAM-DATA-SOURCES.md)。桌面端原有 MIT 声明不覆盖本组件。

## 构建、打包和安装

从仓库根运行：

```sh
python3 input-method/scripts/build.py --reference /Users/qiji/Desktop/AI-Study/qingjian
python3 input-method/scripts/package.py
python3 input-method/scripts/install.py
```

资源经 resource-manifest.json 验证。`--release` 只选择优化构建；不代表发布验收通过。资源和构建产物不进入 Git。

安装包：`input-method/dist/WordMateInput-0.6.4-dev-local.pkg`；本次交付副本和安装说明位于根目录 `dist/`。使用 macOS Installer 的 CurrentUserHomeDirectory 域，安装至 `~/Library/Input Methods/WordMateInput.app`，不复制至系统目录。替换前停止确切旧进程并备份至 `~/Library/Application Support/WordMateInput/install-backups/`；学习数据位于应用支持目录。

2026-10-29 / 0.6.3：修复分段确认丢失原始拼音作用域导致人名无法自动成词的问题；同串拼音分字确认两次可记住完整人名，经过校验的全拼读音用于全拼、简拼和混合拼音召回，双拼按解码后的全拼记忆。原样片段不会吞后续拼音，退格改选会撤回新增读音偏好。修复贪心分词拼出的整句抢占另一读法完整词的问题，例如 `jinan` 优先「济南」，`jin'an` 保留明确分音。详见 [人名与拼音回归](../docs/测试目录/2026-10-29-人名记忆与拼音匹配修复.md)。

2026-10-29 / 0.6.2：同一输入下的已确认选词参与预选和排序，个人偏好不再被默认音节规则或自动整句挤掉。按确认次数调整，重启保留，改选次数超过后可改变首选；全拼、分隔拼音和双拼沿用对应输入键。无需重新训练或清空个人词库。详见 [候选习惯回归](../docs/测试目录/2026-10-29-个人候选排序修复.md)。本包包含下面的云候选读音修复。

2026-10-29：修复确认中文云候选时错误读音覆盖个人词库的问题。直接选词和整句确认共用读音校验，优先使用每个片段保存的合法拼音；不能核实的读音不学为个人短语。此次修复防止新增错误记录，不自动改写历史词条。详见 [回归记录](../docs/测试目录/2026-10-29-云候选读音修复.md)。

安装文件与输入源启用是两个状态。安装后检查：

```sh
"$HOME/Library/Input Methods/WordMateInput.app/Contents/MacOS/WordMateInput" --registration-status
```

`ready` 仅表示父输入法和子模式均启用；实际键入需另行验收。`install.py` 在启用失败时退出码为 2，不宣称可用。`--select` 只在启用检查通过后选择并回读当前输入源。安装器记录 `install-state.json`；首次安装后系统未刷新时，保存工作、注销并重新登录，再从系统设置添加 / 选择 WordMate 输入法。该刷新步骤仍需本机验证。

2026-10-08 本机安装文件成功；离线候选、桌面 RPC 已通过。系统父输入法持续未启用，用户自己的终端复现，真实系统输入仍未验收。没有 Developer ID 证书；本地包使用 ad-hoc 签名，不作为已签名 / 公证的发行包。

2026-11-18 / 0.6.4：修复英文数字不选词、缺少字符的数字键事件、草稿编辑中方括号不能翻页、英文 PageUp/PageDown 提交原文、异步重排丢失原文候选/草稿，以及中间光标的原文候选重复后缀。开始导航后冻结本轮候选编号，窗口显示翻页键与页码；安装脚本跟随当前版本。详见 [候选选择与翻页回归](../docs/测试目录/2026-11-18-候选选择与翻页修复.md)。

## 使用边界

普通输入与词库离线可用；云辅助在 WordMate 设置里开启，复用已有模型和 Thinking 设置。Space 一次采用当前候选（包含混输英文），Option+Space 选英文，Tab 输入空格，四项输入快捷键可自定义；Option+数字沿用基础译词操作。片段预览不入词本，确认写入后的英语采用才产生学习事件；无法确认时保留可复制结果。

配置和习惯：`~/Library/Application Support/WordMateInput/`。桥接：WordMate 的 `ime.sock` 与私有 `ime-token`。`WM_IME_DATA`、`WM_USER_DATA` 用于隔离开发测试；不读取全局剪贴板内容。开发测试与实际应用验证分别记录。

代码与验收状态见 [v0.5.0 实施记录](../docs/测试目录/v0.5.0-实施记录.md)。安装失败时不应反复更换 bundle ID、重置其他输入法或修改系统安全设置。

## 2026-10-09 更新

已安装的新组件使用同一候选窗口的句下译文，原独立辅助窗口已移除。普通中文选词即时上屏；Tab 将英文词及空格保留在黑框草稿，混输中文可选入同一句，支持草稿前文编辑和整句确认翻译。英文混输入与空间边界已补充内核 / 真实模型验证。系统输入源当前已启用。操作见 [清单](../docs/测试目录/v0.5.0-操作清单.md)，确认方案见 [ADR-004](../docs/架构目录/ADR-004-选字与语言确认分离.md)。

控制器回归：在隔离目录运行 `WM_IME_DATA=/tmp/wm-ime-test WM_USER_DATA=/tmp/wm-bridge-test bundle/build.noindex/WordMateInput.app/Contents/MacOS/WordMateInput --interaction-smoke`。使用 NSEvent 和模拟 IMK 文本客户端验证实际分发，不依赖真实模型，不代表所有宿主应用已验收。

2026-10-10：修正 Space 先暂存导致需按两次的问题；短候选保留未选拼音；补可选原文与空会话恢复。通用页可开关自动记忆，常用词条页可手工新增/纠正，个人词库保存后参与候选。

## 0.6.0 英文键盘

默认单击 Shift 切换中英文；Ctrl+Shift+E 和 Caps Lock 也可切换；快捷键在输入法「快捷键」页自定义。英文模式按 Space 一次输入原词和空格；候选用上下键选择，Tab 采用所选补全。从 0.6.4 起，有对应编号时 1–9 选择当前页候选；无对应编号时数字继续输入。没有待输入词时数字直通。输入 `foo123` 可先输入 `foo`、按 Enter 确认，再输入 `123`。标点保持原样；无候选时仍能输入原词。左右键把当前词保留后交给应用，方便编辑前文。无待输入单词时 Tab 是宿主焦点导航；有待输入词时 Enter 仅确认原词，下一次 Enter 才交给宿主。英文键盘不自动调用模型，整句翻译通过 Ctrl+Option+T 主动触发。IDE 默认显示英文黑框补全，终端默认直通，可在常规设置更改。中文模式保持原有 Space/Option+Space/Tab 的行为。

参见 [0.6.0 PRD](../docs/产品需求目录/PRD-v0.6.0-英文键盘.md) 和 [验收记录](../docs/测试目录/v0.6.0-英文键盘回归.md)。

## 中英实时云候选与常用词

输入法云服务开启云联想，桌面开启输入法云辅助后，中文拼音和英文至少3字符前缀可获取云候选；只在确认采用后保存个人词库。常用词根据确认输入次数靠前，重启保留，关闭学习后不新增；网络不可用继续本地输入。复用现有WordMate模型与Thinking。详情见 [ADR-010](../docs/架构目录/ADR-010-中英云候选与个人词频.md)。
