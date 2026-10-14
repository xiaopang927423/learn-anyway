# ADR-010：PDF 专用阅读器与网页样式翻译

2026-10-14，v0.6.1。本地实验版。

## 决策

网页沿用 content.js 的文字节点分组和段落片段协议。双语译文仅新建 span，以 textContent 渲染，复制计算后的 font-weight、font-style、text-decoration-line、vertical-align、white-space；不复制 HTML、id 或事件。仅译文继续替换原文字节点，恢复与网站更新保护沿用原实现。

PDF 使用随扩展打包的 PDF.js 5.4.624，Apache-2.0。锁定 npm 依赖，build-extension.js 从 node_modules 生成被 Git 忽略的 vendor；安装包携带运行脚本、worker、字体、CMap、WASM、ICC 与 LICENSE。不通过 CDN 加载代码。扩展 CSP 仅允许本地脚本及 PDF.js 所需 WASM；PDF.js 关闭 isEvalSupported。

PDF 翻译通过 chrome.tabs.update 接管当前标签，而不是 tabs.create 打开新标签。popup/右键手势在导航前按站点申请读取权限；source、target、mode、autoload 参数传递到 pdf-reader.html，自动加载并翻译，文件选择区默认隐藏。权限或下载失败时展开备用打开入口；“返回原 PDF”回到原网络地址。popup 命令在 PDF 对照页面直接消息路由，不注入普通网页 content.js。

pdf-reader.html 是扩展自身页面，左侧 canvas + TextLayer，右侧安全文本段落。pdf-model.mjs 在 scale=1 的 viewport 中重建行、合并断行/断词，用启发式识别双栏，并保留每行坐标。点击段落按当前缩放高亮原页，对应定位右侧文本。canvas 保持原版视觉，译文不写入 PDF。

## 数据与权限

本地 File → Uint8Array → PDF.js；网络文件必须为不含账号密码的 HTTP/HTTPS URL。阅读器通过用户手势申请单 origin optional_host_permissions，credentials:omit 下载；60 秒下载超时，按流累计 100 MB 限制。拒绝权限或访问失败提供本地文件入口。optional_host_permissions 声明 HTTP/HTTPS 的潜在范围，安装时不自动获得所有站点读取权。

PDF 正文沿用 translate-text → Native Messaging → browser-bridge 的 page action，无 segments；每段拆成不超过 4000 UTF-16 字符，避免拆开代理对。每页最多两个请求并发。选词用 selection，主动入本用 add-word，继续复用模型、Thinking、学习规则，不在扩展保存凭证。后台允许自身阅读器页面（即使无 sender.tab）使用既有通路。

## 生命周期

文档、页面渲染、翻译与选区分别使用序号。翻页/停止/换目标语言使旧翻译失效；换文件清空页面和译文缓存。renderTask/textLayer 取消，旧 canvas render settle 后再复用画布。翻译缓存键为页码、目标语言、段落 id，仅属于当前文档；成功和失败分开保存。停止阻止后续请求与结果写入，已发出的模型请求仍可能完成/计费。

## 取舍

不依赖浏览器内置 PDF 查看器的可注入性。阅读器入口适配本地文件与网络地址；只在用户点击翻译后自动读取当前 PDF，不监听下载或自动接管所有 PDF。与原版覆盖相比，对照阅读避免译文长度导致版面溢出。与 OCR 相比，优先文字层解析，无文字层页面明确提示。本版不保证所有复杂表格/旋转/脚注语义顺序，也不支持 PDF 链接注释交互、密码输入或导出。

## 验证

[测试记录](../测试目录/v0.6.1-网页与PDF回归.md)分别记录模拟接口、真实 PDF/Chromium、真实模型、实际 Chrome 操作。PDF.js 运行包生成产物不进入 Git，依赖锁和构建脚本进入 Git。
