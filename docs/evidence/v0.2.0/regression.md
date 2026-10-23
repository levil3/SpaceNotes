# v0.2.0 合并前回归证据

测试日期：2026-10-23
分支：`feat/macos-adaptation`

## 环境

- macOS 27.0.1（26A434），Apple Silicon
- Node.js 24.22.1（应用内 sidecar）
- 最终本地产物：`build/macos/Levil Notes 0.2.0.dmg`
- SHA-256：`5f7087e2f72d190bc50f1462f0390012eee7669f80d95a91ba95d9a4aef0a5ae`
- 已安装：`/Applications/Levil Notes.app`

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 10 个测试文件，68 项通过 |
| `npm run build:web` | TypeScript 检查和 Vite 构建通过 |
| `swift test` | 12 项发现，11 项通过，1 项因未提供挂载卷跳过 |
| 挂载 APFS 卷专项 | `testMoveToTrashOnExplicitMountedVolume` 1/1 通过 |
| E2E 嵌入脚本 | Swift 转义解码后 JavaScript 解析通过，共 60 条 flow |
| sidecar/SSE 退出回归 | 通过，SIGTERM 后在超时内退出 |
| sidecar 启动令牌 | stdin 首行传递，Git Hook 与父进程环境中不可见 |
| 生产依赖审计 | 根仓库 0，macOS sidecar 0 |
| DMG `hdiutil verify` | 通过 |
| DMG SHA-256 清单 | 从 `build/macos` 校验通过 |
| ad-hoc `codesign --verify --deep --strict` | 通过 |
| Mach-O 清单 | 3 个二进制，均包含 `arm64 x86_64` |
| arm64 启动冒烟 | 最终本地复核因锁屏无法进入 `applicationDidFinishLaunching`；改由 CI 认证 |
| x86_64（Rosetta）冒烟 | 最终本地复核因锁屏无法进入 `applicationDidFinishLaunching`；改由 Intel CI 认证 |
| `spctl --assess` | 拒绝；无 Developer ID 与公证时的预期结果 |

完整开发依赖审计仍报告 19 个开发/打包工具链漏洞，主要来自旧
Electron/Vite/Vitest/electron-builder 依赖链；生产依赖审计为零。本版本没有升级
Windows 发布工具链，避免扩大本次 macOS 适配的变更范围。

## Universal 产物

以下 3 个 Mach-O 均通过 `file` 和 `lipo` 双重检查：

```text
x86_64 arm64  Contents/MacOS/SpaceNotes
x86_64 arm64  Contents/Resources/space-notes-fs
x86_64 arm64  Contents/Resources/node
```

包内 `vault.cjs`、`sidecar-entry.cjs` 与源码哈希一致。旧版应用已备份到：

```text
/tmp/Levil Notes 0.2.0 backup 20261023-202528.app
/tmp/Levil Notes installed a14a36b3 20261023.app
/tmp/Levil Notes installed 28c8fb1d 20261023.app
```

## 使用模型

- 固定种子 `20261023`，执行 3,000 次操作。
- 覆盖读取、创建、写入、搜索、重命名、废纸篓、标签、附件和 Git。
- 失败 0，数据损坏 0，事件验证通过。
- 详细结果见 `docs/evidence/v0.2.0/usage-model.json`。

## 真实应用与 Computer Use

最终本地认证轮遇到 macOS 锁屏：

```text
CGSSessionScreenIsLocked = Yes
```

因此最终源码没有获得本机 WKWebView、窗口生命周期或 Computer Use 截图通过证据。
这两类结果明确标记为 `INCONCLUSIVE`，不沿用旧 SHA 的历史 PASS：

- `docs/evidence/v0.2.0/e2e-wkwebview.json`
- `docs/evidence/v0.2.0/lifecycle.json`

GitHub Actions 配置会在固定 `macos-15` 和 `macos-15-intel` runner 上重新构建并执行
真实 WKWebView 端到端认证；CI 结果将作为跨架构的最终认证证据。

## 已声明边界

- 没有 Intel 实机；x86_64 本机仅通过 Rosetta 冒烟，Intel 全量验证依赖 CI runner。
- 无 Apple Developer ID、无公证；Gatekeeper 首次拦截需要用户手动放行。
- 本机最终 Computer Use 验证因锁屏未完成，不能声明截图验收通过。
