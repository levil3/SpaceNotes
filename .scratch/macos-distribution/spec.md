# SpaceNotes macOS 薄壳与通用 DMG

Status: implemented-ci-pending
Version: v0.2.0

## Problem Statement

SpaceNotes 目前只发布 Windows 版本。macOS 用户无法安装官方应用，而项目维护者
也不希望为了 macOS 复制一份 React 前端或重写已经稳定的笔记与 Git 业务逻辑。

需要在不改变 Windows 用户体验和继续维护现有核心的前提下，提供一个功能与界面
一致的 macOS 应用，并生成同时支持 Intel 和 Apple Silicon 的 DMG。

## Solution

macOS 第一版采用薄壳方案：

- 继续维护一份 React/TypeScript 前端。
- 使用 AppKit 与 WKWebView 承载同一前端。
- 随应用打包 Node sidecar，复用现有笔记库、搜索、附件和 Git 业务服务。
- 通过同一个 `window.levilNotes` 契约连接 Windows Electron 与 macOS WKWebView。
- Swift 只实现窗口、菜单、系统文件操作、WebView 桥接、sidecar 生命周期和打包。
- 产出无 Developer ID 签名、无公证的 universal DMG，最低支持 macOS 13.5。
- 使用独立认证者根据真实工作流验证 macOS 薄壳没有改变既有功能。

## User Stories

1. 作为 macOS 用户，我想下载一个 DMG 并拖入 Applications，以便像普通 Mac 应用一样安装。
2. 作为 Intel Mac 用户，我想直接运行应用，以便不需要依赖 Apple Silicon 专用构建。
3. 作为 Apple Silicon 用户，我想运行原生 arm64 切片，以便获得正常的启动和文件操作体验。
4. 作为 macOS 用户，我想在首次启动时选择或新建笔记库文件夹，以便继续使用现有 Markdown 文件。
5. 作为 macOS 用户，我想自动恢复上次打开的笔记库，以便减少重复操作。
6. 作为 macOS 用户，我想看到与 Windows 相同的文件树、标签、搜索、大纲、反链和 Git 面板，以便沿用已有工作方式。
7. 作为 macOS 用户，我想阅读和编辑 Markdown，并继续使用自动保存，以便像 Windows 版本一样工作。
8. 作为 macOS 用户，我想打开笔记中的相对路径图片和附件，以便现有 Obsidian 笔记库无需修改即可显示完整内容。
9. 作为 macOS 用户，我想通过原生目录选择器打开笔记库，以便正确继承系统权限。
10. 作为 macOS 用户，我想在 Finder 中定位当前笔记，以便使用系统文件工作流。
11. 作为 macOS 用户，我想把笔记移入废纸篓而不是永久删除，以便误操作时可以恢复。
12. 作为 macOS 用户，我想使用与 Windows 一致的窗口按钮布局，以便视觉和操作习惯保持不变。
13. 作为 macOS 用户，我想使用标准应用菜单完成退出、隐藏、全屏和窗口操作，以便符合 macOS 系统习惯。
14. 作为 macOS 用户，我想关闭窗口后应用继续驻留 Dock，并从 Dock 重新打开窗口，以便保持当前工作状态。
15. 作为 macOS 用户，我想查看 Git 状态、差异、历史、分支和忽略规则，以便在应用内继续现有 Git 工作流。
16. 作为 macOS 用户，我想执行暂存、提交、拉取和推送，并继续使用系统 Git 凭据、SSH agent、代理和 Hook。
17. 作为 macOS 用户，我想在外部程序修改笔记库时收到文件树更新，以便不重启应用也能看到变化。
18. 作为 macOS 用户，我想在 sidecar 异常退出时看到明确诊断，而不是窗口空白或静默失败。
19. 作为 macOS 用户，我想让应用在正常退出时清理后台进程，以便没有残留 Node 进程。
20. 作为 macOS 用户，我想让应用只允许可信的应用页面访问本地服务，以便降低本机接口暴露风险。
21. 作为 macOS 用户，我想在浏览器外打开外部链接，以便应用内页面不会被未知站点替换。
22. 作为 Windows 维护者，我想继续只维护一份 React 前端和一套核心业务逻辑，以便避免双份修改和功能漂移。
23. 作为 Windows 维护者，我想保留 Electron 现有行为和测试作为回归基线，以便 macOS 改动不会破坏 Windows。
24. 作为发布维护者，我想通过固定版本的 Node 和可复现脚本生成 universal DMG，以便相同输入产生可检查的产物。
25. 作为发布维护者，我想让构建检查 `.app` 内所有 Mach-O 的架构，以便不会把单架构可执行文件误标为 universal。
26. 作为发布维护者，我想获得 DMG、SHA-256、架构清单和挂载验证结果，以便记录发布证据。
27. 作为认证者，我想通过真实 `window.levilNotes` 接口和真实应用壳层验证行为，以便证据对应用户实际使用。
28. 作为认证者，我想使用固定种子和独立夹具复现抽样场景，以便相同证据可以由其他人重新生成。
29. 作为认证者，我想检查每次操作后的文件哈希、Git 引用和用户可见状态，以便证明没有静默数据损坏。
30. 作为项目维护者，我想明确无签名 DMG 会被 Gatekeeper 拦截，以便安装说明不承诺不可靠的右键打开流程。

## Implementation Decisions

### Shared product architecture

- Windows 和 macOS 继续使用同一份 React/TypeScript 表现层。
- macOS 不复制或重写 React 业务组件。
- 现有笔记库、搜索、附件、大纲、反链、标签和 Git 服务继续作为唯一业务核心。
- Electron IPC 与 macOS sidecar 复用同一组业务服务，不各自实现一套文件或 Git 语义。
- `window.levilNotes` 是前端唯一业务依赖面；React 不判断当前平台或 transport。
- 平台差异只能出现在 Window Electron 宿主、macOS Swift 宿主和 sidecar 适配层。

### macOS host

- macOS 宿主使用 AppKit 创建窗口并承载 WKWebView。
- Swift 负责应用启动、窗口、系统菜单、目录选择、Finder 定位、废纸篓、sidecar
  生命周期和 DMG 打包。
- Swift 不实现搜索、Markdown 索引、Git 分类或笔记业务规则。
- 应用保留 React 顶栏和 Windows 风格窗口按钮，窗口内容铺满并使用无标题栏容器。
- 原生菜单只承载退出、隐藏、全屏、编辑和窗口等系统级操作。
- 系统菜单快捷键由 Swift 处理，既有业务快捷键继续由 React 处理。
- 关闭最后一个窗口后应用继续驻留 Dock；点击 Dock 图标重新显示窗口。
- 正常退出应用时终止 sidecar；窗口关闭时不终止 sidecar。

### Sidecar transport

- sidecar 使用通用 Node 24.22.1，只监听 `127.0.0.1` 的临时端口。
- Swift 每次启动生成不可预测的一次性令牌，通过 sidecar 的 stdin 首行交给进程，并通过
  WKUserScript 注入 WebView。
- sidecar 拒绝无令牌、错误令牌、非预期 Host 或非允许来源的 API 请求。
- sidecar 同时提供已构建 React 资源、业务 API、附件读取和 `vault:changed` 事件。
- API 使用同源 JSON 请求；事件使用 SSE。
- Promise 成功值和错误消息继续遵守 `LevilNotesApi` 现有语义。
- sidecar 通过 stdout 握手报告就绪状态和实际端口，不依赖固定端口。
- sidecar 异常退出时 Swift 最多自动重启一次并重新加载 WebView；再次失败时停止
  重启并显示可诊断错误。

### WebView bridge

- 生产环境加载 sidecar 提供的 React 资源。
- 开发环境加载 Vite，并只把当前 Vite 来源加入允许列表。
- Swift 在 React 启动前注入 `window.levilNotes` 兼容层。
- 普通业务调用通过 `fetch` 进入 sidecar。
- `onVaultChanged` 通过 SSE 订阅，并返回与 Windows 相同的取消订阅函数。
- `chooseVault`、`showInFolder`、`trashNote` 和窗口操作通过 WKWebView message
  handler 交给 Swift。
- 宿主要访问文件前先通过 sidecar 校验路径位于当前笔记库内。
- `notes-asset://` 保持为前端输入格式；Swift 使用 `WKURLSchemeHandler` 将请求
  转发到 sidecar，不修改现有 Markdown 图片来源。
- WebView 导航只允许当前应用来源，其他 HTTP/HTTPS 链接交给系统浏览器。

### Settings and lifecycle

- macOS 设置保存到 `~/Library/Application Support/Levil Notes/settings.json`。
- sidecar 使用相同设置文件完成最近笔记库恢复和外观配置。
- `vault:choose` 使用 `NSOpenPanel`；选择后由 sidecar 校验目录并建立索引。
- `showInFolder` 使用 Finder。
- `trashNote` 使用 `FileManager.trashItem`，成功后再通知 sidecar 刷新索引和广播事件。
- 退出应用时先停止文件监听和服务，再终止 Node 子进程。

### Distribution

- 最低系统版本为 macOS 13.5。
- Node 使用精确版本 24.22.1，分别下载官方 arm64 和 x86_64 包。
- 两个 Node 二进制通过 `lipo` 合并为 universal 可执行文件。
- 最终产出一个 universal `.app` 和一个 DMG，不分别发布 Intel 与 Apple Silicon 包。
- 应用包只包含生产资源：Swift 主程序、universal Node、React 构建产物、sidecar
  脚本和运行时依赖。
- 不打包 npm、npx、Electron、Electron Builder、TypeScript、Vite 或测试依赖。
- 构建必须扫描最终 `.app` 内所有 Mach-O，并确认分别包含 arm64 与 x86_64。
- 构建必须验证 DMG 可创建、可挂载、包含 `.app` 和 Applications 链接。
- 第一版不做 Developer ID 签名，不做 Apple 公证，不包含自动更新。
- 安装文档明确说明首次启动需要通过“系统设置 > 隐私与安全性 > 仍要打开”。
- CI 使用固定的 `macos-15` 和 `macos-15-intel` runner。
- 当前没有 Intel 实机，因此不设置 Intel 人工验证门槛；Intel 由 CI 构建和运行时
  冒烟测试覆盖。

### Clean-room functional certification

- 净室仅用于独立功能验证，不重写现有业务功能。
- 实现者与认证者必须是不同代理或不同人员。
- Windows 当前可观察行为和共享 `window.levilNotes` 契约作为黑盒基准。
- 认证者不能修改实现后继续使用同一轮绿色证据。
- macOS 特定桥接与壳层按加权使用模型抽样 3,000 次，要求零失败、零数据损坏。
- 另执行至少 50 条端到端界面流程，要求全部通过。
- 证据必须包含环境、固定种子、输入夹具、命令、日志、截图和结果清单。

## Testing Decisions

### Test seams

业务主缝是真实的 `window.levilNotes` 接口。测试只观察请求结果、错误、事件和文件
副作用，不直接断言 HTTP 路由内部实现。

壳层黑盒缝是实际启动的 `.app`。认证者通过真实窗口验证菜单、原生文件动作、
sidecar 重启、关闭窗口驻留 Dock 和外部链接行为。

后端回归缝保留现有 `VaultService` 与 `GitService` 测试。macOS 不为同一业务规则
复制第二套单元测试，只补充平台适配和端到端证据。

### Good tests

- 测试外部可观察行为，不依赖内部类名、调用次数或私有数据结构。
- 每个写入或删除场景使用隔离的临时笔记库。
- 每个 Git 场景使用隔离仓库和固定作者信息。
- 输入使用明确夹具或固定随机种子，失败可重放。
- 同时断言返回值、事件和文件系统副作用。
- 错误场景必须验证用户可见错误，而不是只验证进程退出码。

### Required verification

- 现有 TypeScript 检查、前端构建与单元测试保持通过。
- 共享业务接口在 Windows Electron 与 macOS sidecar 上返回相同结构。
- sidecar 拒绝缺失令牌、错误令牌、错误来源和非回环访问。
- WebView 只能导航到当前允许来源，外部链接交给系统浏览器。
- `notes-asset://` 在两种附件路径约定和旧文件名回退场景中正常显示。
- 原生文件夹选择、Finder 定位和废纸篓通过真实应用验证。
- sidecar 首次启动、正常退出、单次崩溃重启和重复崩溃诊断均有证据。
- `vault:changed` 能反映编辑保存、外部修改、创建、重命名和删除。
- universal Node 的 arm64 与 x86_64 切片都能启动。
- `.app` 内全部 Mach-O 架构检查通过。
- DMG 能挂载、校验，并包含可启动应用。
- 无签名安装说明与 Gatekeeper 实际行为一致。

### Independent certification

- 认证使用加权真实工作流，至少覆盖打开/恢复笔记库、阅读、编辑保存、搜索、
  标签、大纲、反链、附件、Git 状态、暂存、提交、拉取和推送。
- 抽样至少 3,000 次，要求 0 次失败和 0 次数据损坏。
- 另执行至少 50 条独立端到端界面流程，要求 0 次失败。
- 每次认证是新证据轮次，不沿用实现者自测结果。
- 最终结论只能是 `CERTIFIED`、`NOT CERTIFIED` 或 `INCONCLUSIVE`。

## Out of Scope

- Apple Developer ID 签名与 Apple 公证。
- Mac App Store 分发和 App Sandbox 审核。
- 应用自动更新。
- Intel 实机人工验证；仅保留 Intel CI 验证。
- 第一版将 Node 文件监听、Git 或全部文件 I/O 改写为 Swift。
- 使用 SwiftUI/AppKit 重写 React 界面。
- Windows 与 macOS 各维护一份 React/TypeScript 前端。
- 新增笔记功能、改变现有业务规则或重新设计 Windows 界面。
- 减少 sidecar 体积、替换 Node 或引入 Rust/C++ 核心。

## Further Notes

- 这是混合净室方案：产品代码复用现有核心，净室纪律只约束独立功能认证。
- Node 24.22.1 的维护期和 macOS 平台支持必须在升级时重新核对。
- 当前 `VaultService.trashNote()` 直接依赖 Electron；实现时只抽出废纸篓宿主动作，
  不把整个文件层迁移到 Swift。
- 现有 Windows 行为是回归基线。macOS 实现不能为了平台便利改变共享业务语义。
- 无签名 DMG 的 Gatekeeper 提示是已知分发体验，不属于功能缺陷。
- 本规格是 wayfinder 地图路线清空后的实现契约；实现完成仍须通过独立认证。
