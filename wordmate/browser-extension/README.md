# WordMate 0.6.1 网页 / PDF 双语对照

在当前网页点击插件“翻译页面内容”，原位显示原文与译文。正在阅读网络 PDF 时，该操作在同一标签接管显示原版页面与段落译文，并自动读取当前 PDF；不新开页面、不重新选择文件。无 .pdf 后缀地址使用“当前 PDF 双语对照”。可返回原 PDF，或停止/恢复。需要当前 PDF 站点读取权限；登录或 blob 文件可通过“更换文件”本地打开。本版不含 OCR。

## 安装与更新

从 dist 的扩展 zip 解压后，在 Chrome/Edge 扩展管理页开启开发者模式，加载此文件夹。已有扩展点击重新加载；版本应显示 0.6.1。运行 WordMate 桌面端并在设置安装浏览器右键连接。

源码 checkout 中的 vendor 不进入 Git，需要先在 wordmate 执行 `npm ci` 和 `npm run build:extension`。`npm run dist` 会自动生成本地 PDF.js 资源。运行时不加载 CDN 脚本。

网页与 PDF 共用桌面模型配置及生词本。PDF 本机解析，只有待翻译文字经桌面发送给模型。PDF.js 5.4.624 的 Apache-2.0 许可位于 vendor/pdfjs/LICENSE，WordMate 整体 GPL-3.0。
