# 01: 扩展共享 API 路由与宿主动作缝

Parent: #1
GitHub: #2

**What to build:** 将 Electron 主进程中的业务请求路由抽成 Windows 与 macOS
sidecar 都能复用的 API 服务，同时为窗口、目录选择、Finder 和废纸篓保留明确的
宿主动作边界。完成后，Windows 仍通过原 IPC 契约工作，但业务方法不再只能由
Electron 主进程调用。

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Electron IPC 与共享 API 服务使用同一组业务方法与返回值。
- [x] `window.levilNotes` 的现有 Promise 成功值和错误消息保持不变。
- [x] 目录选择、Finder、废纸篓和窗口操作与业务服务解耦。
- [x] 新增行为优先测试，覆盖方法映射、错误透传和宿主动作边界。
- [x] 现有 Windows 单元测试、类型检查和前端构建继续通过。
