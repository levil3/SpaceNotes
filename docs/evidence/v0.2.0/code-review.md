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

### CI 与跨平台回归

- Windows 测试无条件是构造 macOS helper，导致 Windows CI 在 `npm test` 阶段失败。
- DMG checksum 清单写的是文件名，但 workflow 从仓库根目录执行校验。
- Swift Package Manager 的 universal 产物目录会随工具链变化，构建脚本不能硬编码
  本机缓存路径。

修复后 native helper 只在 Darwin 注入，依赖 Darwin symlink/helper 的竞态用例按平台
跳过；checksum 在 `build/macos` 内校验；主程序路径由
`swift build --show-bin-path` 动态获取。

### sidecar 退出回调

- 启动失败与 `terminationHandler` 可能对同一次退出各调用一次 `onExit`。

修复后 `SidecarManager` 使用一次性退出闸门，确保每次 sidecar 生命周期只上报一次
退出状态。

## 最终结论

独立 reviewer 在首轮报告上述 P1 后，对修复状态重新复核，未发现新的阻断项，结论为：

```text
NO BLOCKING SOURCE FINDINGS
```

该结论覆盖源码、测试与打包配置。最终产物的独立认证记录见下一节。

## 最后两项 CI 修复的独立复核

`a72be0e` 到 `3f45917` 完成后，新启动的 subagent reviewer 对当前分支重新审查。
首轮复核发现 3 个 P2，均已修复：

1. E2E 启动等待测试只检查字符串，可能被无效等待代码绕过。现改为执行嵌入脚本的
   启动前缀，用 DOM 替身实际等待 3 次并断言 `waiting:app-shell` 到
   `ready:app-shell` 的顺序。
2. DMG 重试测试只检查文本。现用 bash 和 `hdiutil` 替身实际验证第 3 次恢复成功，
   以及连续 5 次失败后返回非零。
3. attach 失败后的清理无法证明“先 detach 再重试”，且 detach 失败会被吞掉。现在
   `detach_mount_point` 检查实际挂载状态并进行最多 3 次有界清理；清理失败立即停止
   attach。测试用有状态替身断言
   `attach,detach,attach,detach,attach`，并覆盖不可清理时 fail closed。

复核后的最终验证：定向契约测试 13/13，`npm test` 89/89，`swift test` 15 项执行
（14 通过，1 项按环境跳过），`bash -n`、E2E 脚本解析和 `git diff --check` 通过。

GitHub Actions run `39974114613`（commit `3f45917`）的 arm64 与 Intel job 均
成功，两端各输出 `WKWebView E2E certified: 60/60`。Intel 证据包为 `CERTIFIED`、
60/60，生命周期功能项 PASS，视觉项保持 `INCONCLUSIVE`。

最终 reviewer 结论：

```text
NO BLOCKING FINDINGS
```

## 剩余风险

- 本机最终 Computer Use 验证因锁屏未执行，不能替代 CI 证据。
- 无 Intel 实机，Intel 运行结论依赖固定 `macos-15-intel` runner。
- 本机直接启动 E2E 在废纸篓动作收到 `Operation not permitted`，根因未证实；CI
  两个架构均通过同一动作，因此未据此修改产品代码。
- 无 Developer ID 与 Apple 公证，Gatekeeper 首次启动拦截是预期行为。
- 开发依赖工具链仍有 19 个已知漏洞；生产依赖审计为 0。
- 当前没有自动更新，因此不覆盖升级与回滚路径。
