# v0.2.0 合并前回归证据

测试日期：2026-10-23
分支：`feat/macos-adaptation`
源码提交：`3f459174e9bd207a42022f21adc6589912d9d5c1`

## 结论

源码、单元测试、共享使用模型、universal DMG 和 CI 真实 WKWebView E2E 均通过；
开发机安装、版本、签名和架构静态检查通过。GitHub Actions run `39974114613` 在
`macos-15` 与 `macos-15-intel` 两个 runner 上全部成功，Intel 的挂载 DMG 运行
结果为 60/60。

本机 Computer Use 仍未完成：macOS 控制台在收尾时保持
`CGSSessionScreenIsLocked=1`，Computer Use 入口返回 `unsupported call`。因此
GitHub issue #10 保持 open，不能把本版本声明为“视觉交互人工验收完成”。

本机自动化 E2E 实际执行到 54/55，在 `transfer-native-trash` 收到
`无法打开废纸篓目录。（Operation not permitted）`。这是本地 `NOT CERTIFIED`
证据，根因尚未证实；同一流程在 arm64 与 Intel CI 均为 PASS，因此未据此改动产品
代码。

## 产物

CI universal artifact：

- SHA-256：`c2d0f95b8f0bb08a22b10c4e758328fba94e09688353b0e19173ae6640d2ac1b`
- CI run：https://github.com/levil3/SpaceNotes/actions/runs/39974114613
- artifact：`macos-universal-v0.2.0`（ID `12510298845`）

最终本地重构建：

- DMG：`build/macos/Levil Notes 0.2.0.dmg`
- SHA-256：`8dc85ea0163c6e7e7002f78c986ad333a8d6b2d30bc65bfd272b76d062316b61`
- 已安装：`/Applications/Levil Notes.app`
- 旧应用备份：
  `/Users/yuzhou/Library/Application Support/Levil Notes/install-backups/20261023-230527/Levil Notes.app`
- 系统截图：`docs/evidence/v0.2.0/macos-final.png`
- 截图 SHA-256：
  `d149d0f04b82548be9f102bd01867df01f4e604d4f0b78a9bd2d994bc0a9b229`

本地与 CI SHA 不同来自 DMG 容器的时间戳等非确定性元数据；两者均由同一提交
`3f45917` 构建，版本均为 `0.2.0`。

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 11 个测试文件，89/89 通过 |
| `npm run build:web` | TypeScript 检查和 Vite 构建通过 |
| `swift test` | 15 项执行，14 通过，1 项因未提供挂载卷按设计跳过 |
| 60 条 WKWebView E2E，arm64 CI | 60/60 通过 |
| 60 条 WKWebView E2E，x86_64 Intel CI | 60/60 通过 |
| 3000 次 sidecar/桥接使用模型 | 3000/3000，失败 0，数据损坏 0 |
| sidecar 启动令牌与 Git Hook 隔离 | 通过 |
| 生产依赖审计 | 根仓库 0，macOS sidecar 0 |
| DMG 创建、校验、挂载 | 通过 |
| ad-hoc `codesign --verify --deep --strict` | 通过 |
| 应用内全部 Mach-O | 3/3 同时包含 `arm64 x86_64` |
| Intel DMG smoke | `SMOKE_READY arch=x86_64` |
| arm64 生命周期功能项 | PASS：窗口、菜单、单次重启、重复崩溃、正常退出 |
| 生命周期视觉项 | INCONCLUSIVE，CI gate 明确允许但未计为视觉通过 |

开发依赖审计仍报告 19 个工具链漏洞，来自旧 Electron/Vite/Vitest/electron-builder
依赖链。生产依赖为零；本次未扩大范围升级 Windows 发布工具链。

## 证据文件

- `docs/evidence/v0.2.0/ci-verification.json`
- `docs/evidence/v0.2.0/e2e-wkwebview-intel.json`
- `docs/evidence/v0.2.0/e2e-wkwebview-intel-diagnostics.txt`
- `docs/evidence/v0.2.0/intel-macho-architectures.txt`
- `docs/evidence/v0.2.0/lifecycle.json`
- `docs/evidence/v0.2.0/usage-model.json`
- `docs/evidence/v0.2.0/code-review.md`
- `docs/evidence/v0.2.0/retro.md`

`e2e-wkwebview.json` 与 `lifecycle.json` 的顶层状态仍记录本机锁屏轮次，不把 CI
结果伪装成本机结果；CI 结论单独记录在 `ciCoverage` 和 `ci-verification.json`。

## 已声明边界

- 无 Apple Developer ID、无公证；Gatekeeper 首次拦截是预期行为。
- 本机没有 Intel 硬件；x86_64 的完整运行证据来自固定 Intel CI runner。
- 本机 Computer Use 交互与截图验收未完成；系统截图已保存，但不冒充 Computer Use
  证据。issue #10 保持 open。
- 本机 `--smoke-test` 在锁屏下 20 秒内未就绪，已安全终止，不声明本地 smoke PASS。
- DMG 为非确定性构建；跨机器比较必须同时核对源码提交和 SHA，不能只比较文件名。
