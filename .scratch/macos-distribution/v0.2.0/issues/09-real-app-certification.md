# 09: 运行真实应用端到端认证与合并前回归

Parent: #1
GitHub: #10

**What to build:** 从 DMG 安装真实 macOS 应用，由独立认证者通过 computer use 和
自动化流程完成至少 50 条端到端场景，并运行完整 Windows/macOS 回归，留下可复核证据。

**Blocked by:** #6, #7, #8, #9

**Status:** ready-for-agent

- [ ] DMG 安装到本机 Applications 并成功启动。
- [ ] computer use 验证主界面、窗口、菜单、笔记编辑、附件和 Git 面板。
- [ ] 至少 50 条真实应用端到端流程全部通过。
- [ ] 3,000 次 sidecar/桥接抽样零失败、零数据损坏。
- [ ] Windows 单元测试、类型检查、前端构建和现有回归全部通过。
- [ ] 独立认证者输出 `CERTIFIED` 或明确失败证据，不由实现者代签。
- [ ] 保存环境、截图、日志、命令、种子、结果和安装包 SHA-256。
