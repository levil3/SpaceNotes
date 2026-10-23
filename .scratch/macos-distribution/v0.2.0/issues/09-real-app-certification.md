# 09: 运行真实应用端到端认证与合并前回归

Parent: #1
GitHub: #10

**What to build:** 从 DMG 安装真实 macOS 应用，由独立认证者通过 computer use 和
自动化流程完成至少 50 条端到端场景，并运行完整 Windows/macOS 回归，留下可复核证据。

**Blocked by:** #6, #7, #8, #9

**Status:** certification-blocked

- [x] DMG 安装到本机 Applications。
- [ ] 应用启动与 computer use 验证主界面、窗口、菜单、笔记编辑、附件和 Git 面板。
- [x] 至少 50 条真实应用端到端流程全部通过：arm64 60/60，Intel 60/60。
- [x] 3,000 次 sidecar/桥接抽样零失败、零数据损坏。
- [x] Windows 单元测试、类型检查、前端构建和现有回归全部通过。
- [x] CI 独立 runner 输出 `CERTIFIED`；本地 Computer Use 仍为 `INCONCLUSIVE`。
- [x] 保存系统截图、环境、日志、命令、种子、结果和 SHA-256。
- [ ] 保存 Computer Use 截图；当前入口返回 `unsupported call`。

CI 认证记录：

- Run: https://github.com/levil3/SpaceNotes/actions/runs/39974114613
- Commit: `3f459174e9bd207a42022f21adc6589912d9d5c1`
- CI SHA: `c2d0f95b8f0bb08a22b10c4e758328fba94e09688353b0e19173ae6640d2ac1b`
- Local SHA: `8dc85ea0163c6e7e7002f78c986ad333a8d6b2d30bc65bfd272b76d062316b61`
- Screenshot: `docs/evidence/v0.2.0/macos-final.png`
- Screenshot SHA: `d149d0f04b82548be9f102bd01867df01f4e604d4f0b78a9bd2d994bc0a9b229`
- Local E2E: 54/55, failed only at `transfer-native-trash` with
  `无法打开废纸篓目录。（Operation not permitted）`; cause not established.
- Local blocker: `CGSSessionScreenIsLocked=1`; Computer Use returned unsupported call.
