# 02: 提供带认证的 Node sidecar HTTP/SSE 服务

Parent: #1
GitHub: #3

**What to build:** Node sidecar 能在临时回环端口启动，使用一次性令牌保护请求，
提供共享业务 API、React 静态资源、附件读取和 `vault:changed` 事件流。通过真实
HTTP 请求可以打开笔记库、读取笔记、搜索并获得事件。

**Blocked by:** #2

**Status:** ready-for-agent

- [ ] sidecar 只监听回环地址并使用临时端口。
- [ ] 缺失令牌、错误令牌、错误 Host 和错误来源均被拒绝。
- [ ] API 返回值和错误语义与 `window.levilNotes` 一致。
- [ ] SSE 能广播保存、创建、重命名、删除和外部文件变化。
- [ ] 静态资源与附件路由不会暴露笔记库外文件。
- [ ] HTTP/SSE 集成测试使用隔离笔记库并通过。

