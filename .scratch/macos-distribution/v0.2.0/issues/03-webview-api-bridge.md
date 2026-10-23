# 03: 实现 WKWebView 的 window.levilNotes 桥接

Parent: #1
GitHub: #4

**What to build:** 注入式 Web 桥接把现有 React 调用转换为 sidecar `fetch`、SSE
和原生 message handler，使同一前端无需平台分支即可在 WKWebView 中运行。开发模式
和 sidecar 同源生产模式都使用同一契约。

**Blocked by:** #3

**Status:** completed

- [x] `window.levilNotes` 覆盖现有接口，不新增 React 平台分支。
- [x] 普通请求、错误和订阅取消行为与 Electron 契约一致。
- [x] 开发来源与生产来源使用允许列表，外部导航交给系统浏览器。
- [x] 宿主动作通过请求 ID 正确 resolve 或 reject。
- [x] 桥接测试覆盖成功、错误、并发请求、SSE 和取消订阅。

Final delivery: CI run `39974114613` at commit `3f45917` passed arm64 and Intel
WKWebView E2E, 60/60 on each runner.
