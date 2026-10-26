# v0.2.0 合并前回归证据

测试日期：2026-10-23
分支：`feat/macos-adaptation`
源码提交：`3f459174e9bd207a42022f21adc6589912d9d5c1`

## 历史结论（`3f45917`）

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

## 2026-10-26 最终本机回归

本节记录基于 `5b8a295`、原生交通灯修订和后续安全修复的最终本机构建与安装，
取代前面的旧本地产物哈希，但保留旧记录作为历史证据。对应结构化摘要见
`docs/evidence/v0.2.0/local-verification.json`。

已修复并有回归覆盖：

- 桥接响应为 `NSNull` 时错误传给只接受数组/对象的 `JSONSerialization`。
- 关闭后 `NSWindow` 被释放，Dock 重开事件访问悬空窗口导致 `SIGSEGV`。
- 窗口创建后的延迟回调可能在快速关闭后重新显示旧窗口。
- 关闭窗口时保留同一 `NSWindow` 和 `WKWebView`，Dock 重开复用原实例。
- macOS 显示 AppKit 原生红黄绿交通灯，Web 层 Windows 风格按钮只在 macOS 隐藏。
- 系统废纸篓改为基于已打开父目录 FD 的 `renameatx_np(..., RENAME_EXCL)`，移除
  `FileManager.trashItem` 对完整源路径的二次解析。
- 目标目录先用 `realpath` 规范化，再从 `/` 以 `O_SEARCH | O_NOFOLLOW` 逐级打开，
  兼容 macOS 的 `/var -> /private/var`，同时保留目录替换竞态防护。
- 同源但非应用壳的 URL（例如 `/assets?...`）改为直接取消，不再误判为外链并拉起
  默认浏览器；后台 E2E 还会阻止并记录任何真实外部应用打开。
- 本机 WKWebView E2E 使用零透明、无阴影、忽略鼠标、非激活且与所有显示器均不
  相交的离屏窗口。

最终本地产物：

- DMG：`build/macos/Levil Notes 0.2.0.dmg`
- DMG SHA-256：
  `3f8f2b5d48900a64e93767eb6b9db762ea43023985a20360031d79b317e8580e`
- 安装后主程序 SHA-256：
  `189bd4d39a049f27a9f4f20baa1b890df11f230a2fe54f80285810e862af4666`
- 安装位置：`/Applications/Levil Notes.app`
- 安装前旧应用备份：
  `build/macos/backups/Levil Notes-live-20261026-150511.app`
- E2E 报告 SHA-256：
  `3a6ad44057abad91e61af232186bf980d71b9a96c1eb5da6add260b3959d41f5`
- E2E 诊断 SHA-256：
  `2370fc2eac3886f7d3ca77a770d2fe707b9eab3ce9f7f921539b96c96aa110ce`
- 界面截图：`docs/evidence/v0.2.0/macos-final.png`
- 界面截图 SHA-256：
  `20b624b18238446f7fe522db59a2e6aa0fdc381416d2a2b23acfa04404e04936`
- 交通灯特写：`docs/evidence/v0.2.0/macos-native-controls.png`
- 交通灯特写 SHA-256：
  `3019feab75012c338af36a027fafeb39624215e79c909823881850d9e4f23511`

本轮检查：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 11 个测试文件，91/91 通过 |
| `swift test` | 20 项执行，19 通过，1 项因未提供挂载卷按设计跳过 |
| 安装包后台 WKWebView E2E | 60/60，`CERTIFIED`，`background-offscreen` |
| 完全离屏 | PASS：窗口帧 `{{1984, 1144}, {1420, 900}}`，与显示器交集为 0 |
| 原生窗口控件 | PASS：关闭、最小化、全屏三个 AppKit 标准按钮均存在且可见 |
| macOS 平台标记与自定义按钮隐藏 | PASS |
| 同源资源顶层导航 | PASS：直接取消，不打开浏览器 |
| 后台测试外部应用启动尝试 | 0 |
| 系统废纸篓实际移动 | PASS：文件进入系统废纸篓，无 TCC 错误 |
| DMG 校验、ad-hoc 签名、挂载 | PASS |
| Mach-O 架构 | 主程序、Node、文件 helper 均为 `x86_64 arm64` |

`lifecycle.json` 仍记录本轮前一次本机运行及其 DMG
`f7609b733d5c81677f272238e19c110c501a3aa473794ca977b040a0cec27453`，不能用于
认证最终包。最终可见窗口的关闭、重开、原生按钮、最小化、全屏和 sidecar 生命周期
由 `macos-15` 与 `macos-15-intel` 两个独立 CI job 重新执行。

历史截图 `docs/evidence/v0.2.0/macos-final-5b8a295.png` 的 SHA-256 为
`d149d0f04b82548be9f102bd01867df01f4e604d4f0b78a9bd2d994bc0a9b229`，仅作为
`5b8a295` 的归档，不代表当前最终包。

## 产物

历史 CI universal artifact（`3f45917`）：

- SHA-256：`c2d0f95b8f0bb08a22b10c4e758328fba94e09688353b0e19173ae6640d2ac1b`
- CI run：https://github.com/levil3/SpaceNotes/actions/runs/39974114613
- artifact：`macos-universal-v0.2.0`（ID `12510298845`）

历史本地重构建（2026-10-23）：

- DMG：`build/macos/Levil Notes 0.2.0.dmg`
- SHA-256：`8dc85ea0163c6e7e7002f78c986ad333a8d6b2d30bc65bfd272b76d062316b61`
- 已安装：`/Applications/Levil Notes.app`
- 旧应用备份：
  `/Users/yuzhou/Library/Application Support/Levil Notes/install-backups/20261023-230527/Levil Notes.app`
- 历史系统截图：`docs/evidence/v0.2.0/macos-final-5b8a295.png`
- 截图 SHA-256：
  `d149d0f04b82548be9f102bd01867df01f4e604d4f0b78a9bd2d994bc0a9b229`

以上是 `3f45917` 轮次的历史记录，已被 2026-10-26 最终本机回归取代。

## 历史自动化检查（`3f45917`）

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
- `docs/evidence/v0.2.0/e2e-wkwebview.json`
- `docs/evidence/v0.2.0/e2e-wkwebview-diagnostics.txt`
- `docs/evidence/v0.2.0/local-verification.json`
- `docs/evidence/v0.2.0/lifecycle.json`
- `docs/evidence/v0.2.0/macos-final.png`
- `docs/evidence/v0.2.0/macos-native-controls.png`
- `docs/evidence/v0.2.0/macos-final-5b8a295.png`
- `docs/evidence/v0.2.0/usage-model.json`
- `docs/evidence/v0.2.0/code-review.md`
- `docs/evidence/v0.2.0/retro.md`

`e2e-wkwebview.json` 与 `local-verification.json` 记录最终本机安装包的 arm64
离屏运行。`lifecycle.json` 是最终包之前的本机历史运行；历史 Intel CI 结论仍单独
记录在 `ci-verification.json`，不能外推到本次待推送的新改动。

## 已声明边界

- 无 Apple Developer ID、无公证；Gatekeeper 首次拦截是预期行为。
- 本机没有 Intel 硬件；x86_64 的完整运行证据来自固定 Intel CI runner。
- 本机 Computer Use 应用绑定因 ScreenCaptureKit 捕获失败而未完成；原生系统截图
  已保存，但不冒充 Computer Use 证据。issue #10 保持 open。
- 为不占用用户当前桌面，本机没有再次运行可见窗口生命周期脚本；该项由双架构 CI
  重新执行后才能外推。
- 本机 `--smoke-test` 在锁屏下 20 秒内未就绪，已安全终止，不声明本地 smoke PASS。
- DMG 为非确定性构建；跨机器比较必须同时核对源码提交和 SHA，不能只比较文件名。
