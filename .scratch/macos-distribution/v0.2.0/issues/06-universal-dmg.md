# 06: 生成 universal Node 与无签名 DMG

Parent: #1
GitHub: #7

**What to build:** 一条可复现构建路径生成同时支持 Intel 与 Apple Silicon 的
通用 `.app` 和 DMG。Node、Swift 主程序和包内全部 Mach-O 都通过双架构检查，
DMG 可挂载并启动应用。

**Blocked by:** #6

**Status:** completed

- [x] 固定 Node 24.22.1 的两个官方架构包经过校验并合并为 universal。
- [x] Swift 主程序与包内全部 Mach-O 均包含 arm64 和 x86_64。
- [x] `.app` 只包含生产前端、sidecar 脚本和运行时依赖。
- [x] DMG 包含应用和 Applications 链接，可挂载、校验和退出挂载。
- [x] 构建不依赖 Developer ID、公证或浮动的 macOS runner。
- [x] 构建测试验证 Node 两架构启动、Mach-O 清单和 DMG 内容。

Final delivery: CI run `39974114613` uploaded universal artifact `12510298845`.
DMG SHA-256 is `c2d0f95b8f0bb08a22b10c4e758328fba94e09688353b0e19173ae6640d2ac1b`;
all three bundled Mach-O files contain `arm64` and `x86_64`.
