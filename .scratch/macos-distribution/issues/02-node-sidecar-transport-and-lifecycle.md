# 确定 Node sidecar 的传输与生命周期

Type: grilling
Status: resolved

## Question

Swift 薄壳与 Node sidecar 之间应采用什么进程模型和传输方式，才能在不改
`window.levilNotes` 契约的前提下可靠支持请求、事件、静态前端资源和附件读取？

需要决定：

- sidecar 只提供 API，还是同时提供打包后的 React 静态资源和附件。
- 使用本机回环 HTTP、Unix domain socket 或 stdio JSON-RPC。
- 如何阻止其他本机进程调用 sidecar，尤其是随机端口、启动令牌和来源限制。
- sidecar 崩溃、应用退出和更新时如何回收进程，是否允许自动重启。
- `vault:changed` 这类服务端事件如何送达 WKWebView。

建议在确认前先完成“通用 Node 运行时与 DMG 打包”研究，避免选择无法打包或
无法稳定启动的进程形态。

## Answer

采用本机回环 HTTP：

- Node sidecar 同时提供打包后的 React 静态资源、业务 API、附件和
  `vault:changed` 事件流。
- 只监听 `127.0.0.1` 的临时端口；每次启动生成 256 位一次性令牌，校验来源，
  拒绝无令牌或非预期路径的请求。
- Swift 启动 sidecar，通过 stdout 握手取得端口与就绪状态，然后让 WKWebView
  加载该回环地址。
- sidecar 发生异常退出时最多自动重启一次；重复失败必须显示可诊断错误并停止。
- `chooseVault`、`trashNote`、`showInFolder` 和窗口操作由 Swift 原生宿主动作
  完成；其余请求继续遵守 `window.levilNotes` 契约。


