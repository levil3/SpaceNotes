# 确定 WKWebView 加载与 API 桥接

Type: grilling
Status: resolved
Blocked by: 02

## Question

在 Node sidecar 传输方案确定后，Swift 宿主如何加载 React 前端并维持与 Windows
完全一致的 `window.levilNotes` 行为？

需要决定：

- WebView 的生产加载地址、开发模式加载地址和导航白名单。
- `window.levilNotes` 注入位置，以及请求、异常和事件回传的 Promise 语义。
- `notes-asset://` 附件 URL 在 WKWebView 中的兼容方式。
- 回环 HTTP 请求如何复用现有事件回调，并阻止 WebView 导航到非应用地址。

## Answer

- 生产环境由 Node sidecar 在回环端口同时提供 React、API、附件和事件。
- 开发环境由 WKWebView 加载 Vite；sidecar 只允许当前 Vite 来源。
- Swift 通过 `WKUserScript` 在页面启动前注入 `window.levilNotes`。
- 普通业务请求使用 `fetch`，`vault:changed` 使用 SSE。
- 原生目录选择、废纸篓和 Finder 定位通过 WKWebView message handler 交给 Swift。
- `notes-asset://` 保持不动，由 Swift `WKURLSchemeHandler` 转发给 sidecar。
- WebView 仅允许当前应用来源；其他链接交给系统浏览器。

平台差异集中在注入脚本、sidecar 路由和 Swift 宿主，React 业务组件不需要平台分支。



