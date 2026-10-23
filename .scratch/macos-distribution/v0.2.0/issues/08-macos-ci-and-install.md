# 08: 建立 macOS 双架构 CI 与安装说明

Parent: #1
GitHub: #9

**What to build:** GitHub Actions 在固定 arm64 和 Intel runner 上构建、检查并运行
架构冒烟测试，保存 DMG 与证据。安装文档说明最低系统、Gatekeeper 拦截和无公证
安装路径。

**Blocked by:** #7

**Status:** completed

- [x] arm64 runner 构建 universal 应用和 DMG。
- [x] Intel runner 校验、挂载并启动 x86_64 切片。
- [x] CI 保存 DMG、SHA-256、Mach-O 架构清单和测试日志。
- [x] 安装文档覆盖首次启动、隐私与安全性放行和卸载。
- [x] CI 不使用 Developer ID、公证或 `macos-latest`。
- [x] 工作流可手动运行并在失败时给出明确错误。
- [x] CI run `39974114613` 两个 job 均通过，Intel E2E 为 60/60。

Final delivery: universal artifact ID `12510298845`; Intel evidence artifact ID
`12510891892`. The Intel job mounted the final DMG, printed
`SMOKE_READY arch=x86_64`, and passed 60/60 E2E.
