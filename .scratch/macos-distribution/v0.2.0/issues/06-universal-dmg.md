# 06: 生成 universal Node 与无签名 DMG

Parent: #1
GitHub: #7

**What to build:** 一条可复现构建路径生成同时支持 Intel 与 Apple Silicon 的
通用 `.app` 和 DMG。Node、Swift 主程序和包内全部 Mach-O 都通过双架构检查，
DMG 可挂载并启动应用。

**Blocked by:** #6

**Status:** ready-for-agent

- [ ] 固定 Node 24.22.1 的两个官方架构包经过校验并合并为 universal。
- [ ] Swift 主程序与包内全部 Mach-O 均包含 arm64 和 x86_64。
- [ ] `.app` 只包含生产前端、sidecar 脚本和运行时依赖。
- [ ] DMG 包含应用和 Applications 链接，可挂载、校验和退出挂载。
- [ ] 构建不依赖 Developer ID、公证或浮动的 macOS runner。
- [ ] 构建测试验证 Node 两架构启动、Mach-O 清单和 DMG 内容。

