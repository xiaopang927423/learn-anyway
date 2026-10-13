# 独立项目与第三方许可

WordMate 独立项目整体采用 GPL-3.0，见 LICENSE。Qingjian 输入核心及原生壳的原始版权、GPL-3.0-or-later 声明保留，见 input-method/NOTICE.md。原 WordMate 桌面组件的历史许可声明为 MIT；维护者已要求本独立项目整体采用 GPL-3.0。依赖、数据与资源的独立声明不被改写，见 input-method/licenses/ 和 input-method/UPSTREAM-DATA-SOURCES.md。

本项目不再从属于示例案例仓库，也不修改其他项目的许可证。安装包包含运行程序和所需词库；不包含模型凭证、个人学习库、用户词条或本机 Git 历史。

## PDF.js

浏览器 PDF 阅读器使用 Mozilla PDF.js 5.4.624（npm pdfjs-dist），Copyright Mozilla Foundation，Apache License 2.0。运行脚本、worker、CMap、标准字体、WASM 与 ICC 资源保留包中各自声明。构建时复制原始 LICENSE 至 browser-extension/vendor/pdfjs/LICENSE，随本地安装包分发。依赖由 package-lock.json 锁定，不将生成的 vendor 目录加入 Git。上游：https://github.com/mozilla/pdf.js 。
