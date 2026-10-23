# v0.2.0 macOS 适配 Retro

日期：2026-10-23
分支：`feat/macos-adaptation`
最终提交：`3f459174e9bd207a42022f21adc6589912d9d5c1`

## 目标回顾

本版本交付 AppKit + WKWebView 薄壳，复用一份 React 前端和现有 Node 业务核心，
生成 Intel 与 Apple Silicon 通用的无签名 DMG，并用固定 GitHub Actions runner
完成双架构运行认证。

流程已完整执行：

1. 需求固化为 v0.2.0 spec。
2. 拆成 9 个带依赖关系的本地 issue，并同步到 GitHub Issues #2-#10。
3. 逐项实现共享 API、sidecar、WebView bridge、macOS 壳层、文件动作、DMG、
   使用模型和 CI。
4. 增加 Node、Swift、桥接、sidecar、路径边界和打包契约测试。
5. 由独立 subagent 多轮 code review，并在最后两项 CI 修复后再次启动新 reviewer。
6. 本地完成 Web 构建、89 项 Node 测试、Swift 测试、3000 次使用模型和 DMG 校验。
7. 推送 `feat/macos-adaptation`，在 arm64 与 Intel runner 上通过 60/60 双架构 E2E。
8. 重建并安装最终本地产物，记录独立 SHA、备份路径和锁屏限制。

## 做得好

- 业务逻辑保持单一来源；Swift 只承担窗口、菜单、系统文件动作、WebView 和
  sidecar 生命周期。
- `window.levilNotes` 是 Windows 与 macOS 的共同契约，React 没有平台分支。
- sidecar 使用 stdin 传递一次性令牌，并校验回环地址、Host、Origin、导航和 frame。
- 文件操作使用 fd-relative 原生 helper，降低中间目录 symlink 的 TOCTOU 风险。
- 创建和重命名采用排他语义，避免在大小写不敏感 APFS 上静默覆盖。
- 打包检查扫描应用内全部 Mach-O，而不是只检查主程序。
- 证据同时记录源码提交、CI SHA、本地 SHA、runner 架构和平台边界。

## 关键问题与修复

### Intel CI 首次失败不是 x86_64 功能失败

Intel job 已成功挂载 DMG、通过签名检查并输出 `SMOKE_READY arch=x86_64`。随后 E2E
在 React 首屏尚未挂载时立即开始，前 24 条失败，后 36 条通过。新增显式等待
`.app-shell` 最多 30 秒的启动闸门后，Intel 60/60 通过。

教训：端到端测试不能只用固定延迟猜页面已就绪，应等待稳定的产品状态。

### DMG 校验存在瞬时资源错误

universal CI 曾在 `hdiutil verify` 遇到
`Resource temporarily unavailable`。构建脚本增加了有界重试：最多 5 次、每次间隔
2 秒，并在耗尽后仍返回非零。校验和挂载都使用同一策略；后续两轮 CI 均通过。

教训：对明确可能瞬时失败的系统命令可以使用有界重试，但不能无限重试或吞掉最终失败。

### 缩小的 E2E 一度降低覆盖

代码审查发现早期脚本删掉了真实写入、废纸篓、搜索、索引和 Git 操作，只检查界面
选择器。最终脚本恢复为 60 条真实 `window.levilNotes` 流程，并在两种架构上执行。

教训：认证脚本本身必须被审查；“界面存在”不能替代真实文件与 Git 副作用验证。

### 本机 GUI 认证被锁屏阻断

最终本地安装包可以完成版本、签名和架构校验，但控制台持续锁屏，AppKit smoke 无法
进入 GUI 就绪状态，Computer Use 入口也不可用。

处理：本地结果明确标记 `INCONCLUSIVE`，CI 只证明对应 runner 的功能行为，issue #10
保持 open，等待交互式会话补做视觉验收。

### 本机废纸篓权限失败未归因

本地直接启动应用的 E2E 跑到 `transfer-native-trash` 时收到
`Operation not permitted`，最终为 54/55、`NOT CERTIFIED`。同一流程在 CI 的
arm64 和 Intel runner 均为 PASS；当前没有足够证据把它归因于产品逻辑或代码修复。
该失败证据原样保留，不用 CI 结果覆盖本地结论。

## 最终指标

- Node 单元/集成测试：11 个文件，89/89。
- Swift 测试：15 项执行，14 通过，1 项按环境跳过。
- 使用模型：3000/3000，失败 0，数据损坏 0。
- WKWebView E2E：arm64 60/60；Intel x86_64 60/60。
- 生命周期：功能 PASS；视觉 INCONCLUSIVE。
- 应用内 universal Mach-O：3/3。
- 生产依赖漏洞：根仓库 0，macOS sidecar 0。
- CI DMG SHA-256：
  `c2d0f95b8f0bb08a22b10c4e758328fba94e09688353b0e19173ae6640d2ac1b`。
- 本地 DMG SHA-256：
  `8dc85ea0163c6e7e7002f78c986ad333a8d6b2d30bc65bfd272b76d062316b61`。

## 后续行动

1. 解锁交互式 macOS 会话后，用 Computer Use 验证最终安装包并关闭 issue #10。
2. 下一版本如要求无 Gatekeeper 拦截，再引入 Developer ID、公证和发布密钥管理。
3. 单独升级旧 Electron/Vite/Vitest 工具链，处理 19 个开发依赖告警。
4. 若需要可复现的逐字节 DMG，再设计固定文件时间戳和 DMG 元数据策略。
