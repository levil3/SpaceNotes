# 锁定 macOS 复用架构

Type: grilling
Status: resolved

## Question

macOS 第一版如何在“原生 Swift 薄壳”、单一 React/TypeScript 前端和同一套底层
业务逻辑之间划界，才能最大化复用并避免 Windows 与 macOS 双份维护？

## Answer

- React/TypeScript 前端只维护一份，由 Swift + WKWebView 加载。
- macOS 应用打包 Node sidecar，直接复用现有 `VaultService`、`GitService`
  和业务核心。
- Windows 与 macOS 统一遵守 `window.levilNotes` 接口契约。
- Swift 只负责窗口、菜单、文件选择、WebView 桥接、sidecar 生命周期和 DMG 构建。
- 第一版不把全部 I/O 改为 Swift；后续如需减小体积或提高原生安全，可在契约不变
  的前提下逐步替换。
- 净室只针对功能验证。现有功能是行为基准，不重写、不重新设计。
- 第一版交付无签名、无公证的 Intel + Apple Silicon 通用 DMG。

