# SpaceNotes macOS 薄壳与通用 DMG

## Destination

以现有 Windows 版本为行为与界面基准，交付一个单一 React/TypeScript 前端、
Swift + WKWebView 薄壳和 Node sidecar 组成的 macOS 应用，并产出同时支持
Intel 与 Apple Silicon 的无签名 DMG。

## Notes

- 这是规划地图。实现开始前，前沿必须清空，并由用户确认共享理解。
- Windows 版本继续维护主要业务逻辑；macOS 优先最大化复用，不复制 React 前端。
- macOS 第一版使用 Node sidecar 复用 `VaultService`、`GitService` 和业务核心。
- `window.levilNotes` 是 Windows 与 macOS 共用的稳定表现层接口契约。
- Swift 第一版只负责窗口、菜单、文件选择、WebView 桥接、进程生命周期和 DMG 构建。
- 不使用 JavaScriptCore 重写核心，也不在首版把全部 I/O 改为 Swift。
- 净室只用于独立功能验证，不重写已经完善的 Windows 功能。
- 无签名、无公证；不进入 Mac App Store。
- 后续原生 I/O 替换和体积优化不属于本轮目的地。
- 使用 `grilling`、`domain-modeling`、`clean-room-build`、`verify-this`。
- 实现契约见 [spec.md](spec.md)。

## Decisions so far

- [锁定 macOS 复用架构](issues/01-lock-reuse-architecture.md): 单一 React 前端、Swift WKWebView 薄壳、Node sidecar、共享 `window.levilNotes` 契约；净室仅做独立功能验证。
- [确定 Node sidecar 的传输与生命周期](issues/02-node-sidecar-transport-and-lifecycle.md): 回环临时端口同时提供 React、API、附件和事件；一次性令牌；Swift 管理子进程并最多重启一次。
- [确定 WKWebView 加载与 API 桥接](issues/03-wkwebview-native-shell-contract.md): sidecar 提供生产资源；WKUserScript 注入契约；fetch/SSE 承载请求与事件；保留 notes-asset scheme。
- [定义功能一致性的独立认证协议](issues/04-functional-parity-evidence.md): 独立认证者按使用模型抽样 3,000 次零失败、零数据损坏，并跑至少 50 条端到端流程。
- [研究通用 Node 运行时与 DMG 打包](issues/05-universal-node-and-dmg-research.md): Node 24.22.1 双架构可 lipo 合并并在两切片运行；最低 macOS 13.5；无签名 DMG 需手动通过 Gatekeeper。
- [确定 macOS 支持矩阵与安装体验](issues/06-distribution-support-matrix.md): macOS 13.5+、双架构 CI、无 Intel 实机门槛、无自动更新、无签名安装需手动放行。
- [确定 macOS 窗口、菜单与生命周期](issues/07-macos-window-menu-lifecycle.md): 共享 React 内容，窗口使用 AppKit 原生交通灯，系统菜单和宿主文件动作原生实现，关窗驻留 Dock 并复用窗口状态。

## Not yet specified

路线已经清晰，没有仍需在实现前决定的问题。工作流权重、固定种子、CI 缓存和
具体产物校验属于实现阶段的可执行细节，不再需要新的设计决策。

## Out of scope

- Apple Developer ID 签名与公证。
- Mac App Store 分发和沙盒审核。
- SwiftUI/AppKit 重写 React 界面。
- 第一版将文件监听、Git 和全部文件 I/O 从 Node 改为 Swift。
- Windows 与 macOS 各维护一份 React/TypeScript 前端。
