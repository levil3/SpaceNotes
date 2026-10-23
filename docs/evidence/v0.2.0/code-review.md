# v0.2.0 独立 Code Review 记录

日期：2026-10-23
分支：`feat/macos-adaptation`

## 审查范围

相对 `origin/main` 的最终工作树，重点覆盖：

- Electron IPC 与共享 API 路由
- sidecar 启动、认证、HTTP/SSE、导航与来源校验
- WKWebView bridge 和宿主动作请求关联
- Swift 路径边界、废纸篓、sidecar 生命周期
- universal 构建、DMG 和 CI
- Windows 现有行为与测试回归

审查由独立 subagent 执行，实现者负责确认和修复。修复后重新运行相关测试并由后续
独立审查复核最终状态。

## 已发现并修复

### 路径与文件系统边界

- 中间目录 symlink 存在 TOCTOU 风险。
- `createNote` 需要同时覆盖笔记库根目录和嵌套目录创建。
- 跨卷废纸篓不能只写当前用户主目录的 `.Trashes`。
- 废纸篓同名文件必须使用排他 rename，不能覆盖已有笔记。

修复后读写、rename、mkdir 使用 fd-relative helper；默认废纸篓按目标卷选择，并以
`renameatx_np(RENAME_EXCL)` 处理重名。

### sidecar 启动令牌

- 通过环境变量传递的一次性 token 可能被 Git Hook 或子进程读取。

修复后 token 通过 sidecar stdin 首行传递。父进程环境不可见，并有真实 Git Hook
集成测试覆盖。

### WebView 导航与桥接

- `notes-asset://`、`/assets` 和 `/api` 顶层导航可能绕过正常页面边界。
- 原生桥消息需要同时校验 main frame、页面 URL、frame URL 和 security origin。

修复后非应用页面导航 fail closed，桥接只接受可信应用文档和主 frame 请求。

### 宿主资源与失败行为

- macOS helper 缺失时需要 fail closed，而不是降级为不安全的路径操作。

修复后缺失 helper 会明确拒绝操作，并保留可诊断错误。

## 最终结论

独立 reviewer 在修复后的最终源码状态上未发现阻断项，结论为：

```text
NO BLOCKING SOURCE FINDINGS
```

该结论只覆盖源码、测试与打包配置，不等于最终产物认证。最终产物仍需通过 CI 的
真实 WKWebView E2E、Intel runner 和 DMG 校验。

## 剩余风险

- 本机最终 Computer Use 验证因锁屏未执行，不能替代 CI 证据。
- 无 Intel 实机，Intel 运行结论依赖固定 `macos-15-intel` runner。
- 无 Developer ID 与 Apple 公证，Gatekeeper 首次启动拦截是预期行为。
- 开发依赖工具链仍有 19 个已知漏洞；生产依赖审计为 0。
- 当前没有自动更新，因此不覆盖升级与回滚路径。
