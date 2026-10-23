# 确定 macOS 窗口、菜单与生命周期

Type: grilling
Status: resolved

## Question

Swift 薄壳如何呈现现有 Windows 界面，并把窗口、菜单、宿主动作和应用生命周期
映射成一致的 macOS 体验？

需要决定：

- 保留 React 顶栏中的 Windows 窗口按钮，还是隐藏它们并使用 macOS 原生交通灯。
- 无边框/全尺寸内容窗口的实现边界，以及全屏、缩放和多显示器行为。
- macOS 原生菜单与现有快捷键如何共存，避免同一操作触发两次。
- `vault:choose` 使用 `NSOpenPanel`，`showInFolder` 使用 Finder，`trashNote`
  使用 `FileManager.trashItem`；sidecar 只负责后续索引与事件同步。
- 设置文件保存位置，以及应用关闭窗口后是否继续驻留 Dock。
- sidecar 启动失败、被系统终止或应用退出时的用户可见状态与进程回收。

当前约束：

- `VaultService.trashNote()` 直接调用 Electron `shell.trashItem`，需要抽出可注入的
  trash adapter，由 Windows Electron 主进程和 macOS Swift 薄壳分别实现。
- `app:show-in-folder` 和 `vault:choose` 本来就是宿主动作；macOS 由 Swift
  调用 Finder 与 `NSOpenPanel`，不增加 Node 原生依赖。

## Answer

- 保留 React 顶栏和 Windows 风格窗口按钮，Swift 使用内容铺满的无标题栏窗口。
- 增加 macOS 原生应用菜单，只承载退出、隐藏、全屏、编辑和窗口等系统级操作。
- 系统菜单快捷键由 Swift 处理，现有业务快捷键继续由 React 处理。
- 关闭窗口后应用继续驻留 Dock；点击 Dock 图标重新打开窗口。
- 设置保存到 `~/Library/Application Support/Levil Notes/settings.json`。
- `trashNote` 由 Swift 使用 `FileManager.trashItem`，随后通知 sidecar 刷新索引。
- 正常退出时终止 sidecar；异常退出最多重启一次，再次失败显示诊断信息。
