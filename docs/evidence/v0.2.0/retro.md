# v0.2.0 macOS 适配 Retro

日期：2026-10-23
分支：`feat/macos-adaptation`

## 目标回顾

本版本交付 macOS AppKit + WKWebView 薄壳，复用现有 React 前端与 Node 业务核心，
生成 Intel 与 Apple Silicon 通用的无签名 DMG，并通过自动化、独立审查和真实应用
认证控制跨平台回归风险。

流程已执行：

1. 将需求固化为 v0.2.0 spec。
2. 将 spec 拆成 9 个带依赖关系的 issue，并同步到 GitHub Issues。
3. 按 issue 实现共享 API、sidecar、WebView bridge、macOS 壳层、文件动作、DMG、
   使用模型和 CI。
4. 增加 Node、Swift、桥接、sidecar、路径边界和打包测试。
5. 由独立 subagent 进行多轮 code review，并修复发现的问题。
6. 运行本地回归、3000 次使用模型、DMG 校验与跨架构检查。
7. 推送分支触发固定 arm64/Intel runner 的最终认证。

## 做得好

- 业务逻辑保持单一来源，Swift 只承担宿主职责，没有复制 React 或笔记核心。
- 使用 `window.levilNotes` 作为唯一业务接口，Windows 和 macOS 共用行为契约。
- 设计阶段先确认 sidecar 与 thin-shell 边界，避免第一版把全部 I/O 重写为 Swift。
- 安全边界采用 fail-closed：sidecar token、Host/Origin、WebView 导航、frame 校验和
  路径穿越均在进入业务层前拒绝。
- 路径操作使用 fd-relative 校验，降低中间目录 symlink 的 TOCTOU 风险。
- 跨卷废纸篓使用目标卷 `.Trashes/<uid>`，并以原子 rename 防止同名覆盖。
- 打包检查不仅看主程序，还检查应用内全部 Mach-O，避免“主程序 universal、
  sidecar 单架构”的假通过。
- 固定的 3000 次使用模型覆盖真实桥接契约、事件、文件副作用和 Git 引用。

## 发现的问题

### 本机最终认证受锁屏阻塞

最终源码轮到达时，macOS 控制台仍处于：

```text
CGSSessionScreenIsLocked = Yes
```

AppKit 无法建立 GUI 会话，`--smoke-test` 也无法进入
`applicationDidFinishLaunching`。因此本机最终 WKWebView、窗口生命周期和 Computer
Use 证据只能标记为 `INCONCLUSIVE`，不能沿用旧 SHA 的 PASS。

改进方向：GUI 认证必须安排在已解锁的交互式会话；无交互会话时，将最终认证交给
固定 macOS CI runner，并明确区分本地与 CI 证据。

### 旧证据容易与新产物混用

早期 50/58 条流程和生命周期结果属于旧 DMG SHA。最终产物变化后，如果只保留
“PASS”文件，读者无法判断证据对应哪次构建。

改进方向：每轮证据必须包含 artifact SHA-256、源码版本、环境和轮次状态；历史结果
只能放在显式 `previousRound` 中，不得作为当前结论。

### 本地与打包运行时版本需要区分

开发机默认 Node 与包内固定 Node 可能不同。使用模型首次结果记录的是宿主机 Node，
不能代表应用实际 sidecar 运行时。

改进方向：认证命令直接调用包内 Node 24.22.1，并在报告中记录 `process.version`。

### 首次 CI 暴露了环境耦合

首次 macOS CI 在拷主程序时失败，因为脚本硬编码了本机 Swift Package Manager 的
`.build/out/Products/Release` 路径。独立复审还发现 Windows 测试会无条件加载
macOS helper，以及 DMG checksum 的工作目录不一致。

修复后主程序路径由 `swift build --show-bin-path` 动态获取，非 Darwin 测试不再加载
native helper，checksum 在产物目录内校验。这些问题说明：本地绿色不能替代干净
runner 上的首次构建。

## 关键指标

- Node 单元/集成测试：10 个文件，68/68。
- Swift 测试：12 项发现；11 项常规通过，挂载卷专项单独 1/1。
- 使用模型：3000/3000，失败 0，数据损坏 0。
- E2E flow 定义：60 条，脚本解析通过，最终执行由 CI 认证。
- 应用内 universal Mach-O：3/3。
- 生产依赖漏洞：根仓库 0，macOS sidecar 0。
- 本地产物 SHA-256：
  `5f7087e2f72d190bc50f1462f0390012eee7669f80d95a91ba95d9a4aef0a5ae`。

## 后续行动

1. 在 CI 获取最终 arm64 与 Intel WKWebView 证据，并回写本地证据文件。
2. 只有在 CI 全部通过后才关闭认证 issue；本机 Computer Use 缺失保持显式记录。
3. 后续升级 Electron/Vite/Vitest 工具链时单独处理 19 个开发依赖告警。
4. 下一版本若引入 Developer ID，再增加签名、公证和 Gatekeeper 无提示安装认证。
