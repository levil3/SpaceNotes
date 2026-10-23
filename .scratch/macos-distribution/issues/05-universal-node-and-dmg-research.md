# 研究通用 Node 运行时与 DMG 打包

Type: research
Status: resolved

## Question

在无签名、无公证且同时支持 Intel 与 Apple Silicon 的约束下，怎样可靠地把 Swift
应用、React 静态资源、Node sidecar 和全部依赖打进一个可启动的 DMG？

研究必须回答：

- Node 官方 arm64/x64 二进制能否合并为 universal 可执行文件，以及推荐做法。
- Node 版本选择、动态库和原生依赖是否需要分别验证两种架构。
- Swift 应用、Node sidecar 和资源在 `.app/Contents` 中的推荐布局。
- DMG 能否只包含一个 universal `.app`，并确保所有嵌套可执行文件架构匹配。
- 无签名应用在其他 Mac 上的 Gatekeeper 与“右键打开”体验。
- 本地和 GitHub Actions macOS runner 上可复现的构建、校验和产物检查命令。

输出应引用官方文档或可复核的一手资料，并在独立的
`research/universal-node-dmg` 分支保存研究记录。

## Answer

方案可行。固定 Node `24.22.1`，分别使用官方 `darwin-arm64` 与 `darwin-x64`
包，通过 `lipo` 合并为 universal `node`；最终只分发一个包含双架构 Mach-O 的
`.app`，DMG 本身不需要区分架构。

- 合并后的 Node 已实测在 `x86_64` 与 `arm64` 两个切片启动。
- 官方 Node 24 的 macOS 最低支持版本是 `13.5`，应作为第一版最低系统基线。
- `fsevents@2.3.3` 当前是 universal，但最终 `.app` 内所有 Mach-O 仍必须扫描。
- React `dist/` 放入 `Contents/Resources/web/`；Node sidecar 与生产依赖放入
  `Contents/Resources/sidecar/`；universal Node 放入 `Contents/MacOS/`。
- 无 Developer ID 和公证时仍可生成、挂载和运行 DMG，但下载后的首次启动会被
  Gatekeeper 拦截，用户需要在“隐私与安全性”中选择“仍要打开”。
- CI 应分别使用固定的 `macos-15-intel` 与 `macos-15` runner 验证，避免依赖
  `macos-latest`。

研究记录：

- [universal-node-dmg.md](https://github.com/levil3/SpaceNotes/blob/research/universal-node-dmg/.scratch/macos-distribution/research/universal-node-dmg.md)
- 研究分支：`research/universal-node-dmg`
- 提交：`2725be452ac1e5e955ce714148f9c340fa8a64a4`
- 未创建 PR
