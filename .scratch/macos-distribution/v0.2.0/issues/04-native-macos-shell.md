# 04: 创建 AppKit + WKWebView macOS 薄壳

Parent: #1
GitHub: #5

**What to build:** 启动一个真实 macOS 应用，由 Swift 启动并监管 Node sidecar，
等待就绪后显示加载共享 React 前端的主窗口，并支持原生 macOS 交通灯、系统菜单、
关闭窗口驻留 Dock、窗口状态复用和 sidecar 异常恢复。

**Blocked by:** #4

**Status:** completed

- [x] 应用可从构建目录启动并显示真实 React 界面。
- [x] 主窗口使用透明标题栏内容布局，并显示 AppKit 原生交通灯。
- [x] Web 层 Windows 窗口按钮只在 macOS 隐藏，Windows 默认样式不变。
- [x] 系统菜单提供退出、隐藏、全屏和窗口操作。
- [x] sidecar 正常退出、单次异常重启和重复异常诊断可验证。
- [x] 关闭窗口后应用驻留 Dock，点击 Dock 图标复用原窗口和 WebView。
- [x] Swift 单元测试覆盖 sidecar 就绪、失败、重启和进程回收。
- [x] arm64 CI 生命周期功能项 PASS；共享界面由 60/60 E2E 覆盖。

Final delivery: CI run `39974114613` at commit `3f45917` passed. Lifecycle
functional status is PASS; visual capture remains INCONCLUSIVE.

2026-10-26 revision: user feedback superseded the original Windows-style
controls decision. The local worktree now uses native traffic lights and
WebView/window reuse; Windows defaults remain unchanged. Final native-control
evidence is in `docs/evidence/v0.2.0/macos-native-controls.png`.

Final local candidate verification: Node tests 91/91, Swift 19 executed with 1
expected mount-volume skip, and the installed app's background WKWebView E2E
passed 60/60 without becoming the frontmost application. The workflow now runs
visible native lifecycle checks on both `macos-15` and `macos-15-intel`.
