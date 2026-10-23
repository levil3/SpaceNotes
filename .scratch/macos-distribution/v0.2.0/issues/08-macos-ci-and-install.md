# 08: 建立 macOS 双架构 CI 与安装说明

Parent: #1
GitHub: #9

**What to build:** GitHub Actions 在固定 arm64 和 Intel runner 上构建、检查并运行
架构冒烟测试，保存 DMG 与证据。安装文档说明最低系统、Gatekeeper 拦截和无公证
安装路径。

**Blocked by:** #7

**Status:** ready-for-agent

- [ ] arm64 runner 构建 universal 应用和 DMG。
- [ ] Intel runner 校验并启动 x86_64 切片。
- [ ] CI 保存 DMG、SHA-256、Mach-O 架构清单和测试日志。
- [ ] 安装文档覆盖首次启动、隐私与安全性放行和卸载。
- [ ] CI 不使用 Developer ID、公证或 `macos-latest`。
- [ ] 工作流可手动运行并在失败时给出明确错误。
