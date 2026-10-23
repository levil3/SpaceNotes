# 04: 创建 AppKit + WKWebView macOS 薄壳

Parent: #1
GitHub: #5

**What to build:** 启动一个真实 macOS 应用，由 Swift 启动并监管 Node sidecar，
等待就绪后显示加载共享 React 前端的主窗口，并支持一致的窗口按钮、系统菜单、
关闭窗口驻留 Dock 和 sidecar 异常恢复。

**Blocked by:** #4

**Status:** ready-for-agent

- [ ] 应用可从构建目录启动并显示真实 React 界面。
- [ ] 主窗口使用无标题栏内容布局并保留现有窗口按钮行为。
- [ ] 系统菜单提供退出、隐藏、全屏和窗口操作。
- [ ] sidecar 正常退出、单次异常重启和重复异常诊断可验证。
- [ ] 关闭窗口后应用驻留 Dock，点击 Dock 图标恢复窗口。
- [ ] Swift 单元测试覆盖 sidecar 就绪、失败、重启和进程回收。

