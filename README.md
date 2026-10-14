# WordMate / Learn Anyway

[English](#english) · [介绍页源码](website/) · [安装说明](docs/测试目录/本地安装包使用说明.md)

WordMate 把中英输入法、网页翻译插件和生词本放在同一套学习工具中：输入时表达，阅读时理解，保存后复习与默写。

独立仓库：**https://github.com/xiaopang927423/learn-anyway**。后续不再同步旧案例仓库。

## 功能

- 中英与混合输入，Shift 切换；中文数字候选直接上屏、Tab 进入草稿；英文 Space 正常空格、Tab 采用补全。
- 实时中英云候选，确认后记忆常用词，个人词频参与排序，重启保留。
- Chrome/Edge 整页双语对照、仅译文、划词/悬停/右键翻译、自动补译新内容及恢复原文。
- 桌面查词、生词本、间隔复习、默写、编辑和删除撤销、CSV 导出与每日提醒。
- 复用用户配置的 OpenAI 兼容模型，支持 Diffu 和 Thinking 开关。

## 安装与打包

当前 macOS arm64 安装包：`dist/WordMate-0.6.1-macOS-arm64.pkg`，包含桌面应用、输入法和浏览器扩展文件。适用于 Apple Silicon macOS 13+，Python3 需可用。扩展需手动加载；学习数据、配置与用户词条不随包分发。

```sh
npm --prefix wordmate ci
npm --prefix wordmate run dist
python3 input-method/scripts/build.py
python3 scripts/package-local.py
```

首次构建输入法需要按 [输入法说明](input-method/README.md) 准备固定资源。安装包不加入 Git 历史；发布资产与源码分开。

## 双语介绍页

`website/` 是无构建依赖的静态介绍页，支持中英文切换、15 步产品动画、操作说明与常见问题。动画为示意，不请求模型、不写个人词库。

```sh
python3 -m http.server 8765 --directory website
# http://127.0.0.1:8765
wordmate/node_modules/.bin/electron scripts/check-website.js
```

GitHub Pages 发布配置见 `.github/workflows/pages.yml`；首次需在仓库 Settings → Pages 选择 GitHub Actions。尚未完成部署时，不将预期 URL 当作已上线链接。

## 项目与许可

- [文档中心](docs/README.md)、[管理规范](docs/管理规范.md)、[版本记录](CHANGELOG.md)
- [GPL-3.0](LICENSE)、[第三方声明](THIRD_PARTY_NOTICES.md)

输入法仍有已知和未知 bug，请保留系统输入法并先在普通文本中试用。安装包为本地开发包，未进行 Developer ID 公证。模型凭证和学习库只在本机管理，不提交到 Git。

## English

WordMate combines bilingual input, a browser translation extension, and a vocabulary notebook. Write in Chinese or English, read paired translations, save unfamiliar words, and practice through review and dictation.

The independent repository is **xiaopang927423/learn-anyway**. The Chinese/English introduction page in `website/` includes a controllable 15-step animated walkthrough covering the keyboard, browser extension, vocabulary notebook, review, and spelling practice.

The local installer `WordMate-0.6.0-macOS-arm64.pkg` includes the desktop app, input method, and extension files. It supports Apple Silicon macOS 13+. Installer scripts require Python3. Enable WordMate in macOS Input Sources and load the extension manually. Upgrades preserve study records and personal dictionaries.

Cloud features use your configured OpenAI-compatible model. Input frequency and review scores are separate. Demo animations do not call a model or write study records. Experimental input software still has bugs; keep a system keyboard available. Project license: GPL-3.0, with upstream and third-party notices retained.
