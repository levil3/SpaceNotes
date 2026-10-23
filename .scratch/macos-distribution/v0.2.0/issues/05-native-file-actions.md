# 05: 接通原生文件动作与 notes-asset 协议

Parent: #1
GitHub: #6

**What to build:** macOS 用户可以通过原生目录选择器打开笔记库，在 Finder 中定位
笔记，把笔记移入废纸篓，并正常显示 Markdown 中的本地图片。宿主操作仍需经过笔记库
边界校验。

**Blocked by:** #5

**Status:** ready-for-agent

- [ ] `vault:choose` 使用原生目录选择器并建立共享笔记库索引。
- [ ] `showInFolder` 使用 Finder 定位当前笔记。
- [ ] `trashNote` 使用系统废纸篓，并刷新 sidecar 索引与事件。
- [ ] `notes-asset://` 通过 WKURLSchemeHandler 显示笔记相对和库相对附件。
- [ ] 所有宿主动作拒绝笔记库外路径。
- [ ] 集成测试和真实应用测试覆盖文件副作用。

