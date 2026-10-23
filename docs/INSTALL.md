# SpaceNotes 安装与运行

## 方式一：安装 Windows 安装包

这是普通用户推荐的方式，不需要安装 Node.js。

1. 打开 [SpaceNotes Releases](https://github.com/levil3/SpaceNotes/releases)。
2. 在最新版本中下载 `Levil Notes Setup x.y.z.exe`。
3. 双击安装包，选择安装位置并完成安装。
4. 从开始菜单或桌面快捷方式启动 `Levil Notes`。
5. 首次启动时选择已有笔记文件夹，或新建一个空文件夹作为笔记库。

当前安装包未购买代码签名证书。Windows SmartScreen 可能显示“Windows 已保护你的
电脑”，此时可以点击“更多信息”，核对文件来源后选择“仍要运行”。

## 使用 Git 功能

SpaceNotes 直接调用系统 Git，不保存 GitHub 密码或私钥。

1. 安装 [Git for Windows](https://git-scm.com/download/win)。
2. 重新启动 SpaceNotes。
3. 打开一个已经初始化为 Git 仓库的笔记目录，或使用系统终端执行：

   ```powershell
   cd D:\path\to\notes
   git init
   git remote add origin https://github.com/your-name/your-notes.git
   ```

4. 第一次推送前，请先在系统终端完成 Git 凭据或 SSH 配置。

可使用以下命令确认环境：

```powershell
git --version
git -C D:\path\to\notes status
git -C D:\path\to\notes remote -v
```

如果命令行可以正常拉取和推送，但 SpaceNotes 中提示 Git 不可用，请完全退出应用后
重新启动，并从开始菜单启动新版本。

## 方式二：安装 macOS 通用 DMG

macOS 13.5 及以上版本可使用同一个 DMG，应用同时包含 Intel（x86_64）和
Apple Silicon（arm64）切片。

当前 v0.2.0 验证产物在分支
[Actions run 39974114613](https://github.com/levil3/SpaceNotes/actions/runs/39974114613)
的 `macos-universal-v0.2.0` artifact 中。下载并解压后：

1. 双击 `Levil Notes 0.2.0.dmg`，把 `Levil Notes` 拖入 `Applications`。
2. 在“应用程序”中双击 `Levil Notes`。
3. 首次启动时选择已有笔记文件夹，或新建一个空文件夹作为笔记库。

合并到主分支并发布 GitHub Release 后，普通用户可直接从
[SpaceNotes Releases](https://github.com/levil3/SpaceNotes/releases) 下载同版本
DMG。

当前 DMG 只使用 ad-hoc 签名，没有 Developer ID 签名，也未经过 Apple 公证。
首次启动被 Gatekeeper 拦截时，打开“系统设置 > 隐私与安全性”，在安全提示下点击
“仍要打开”，完成系统身份验证后再启动。不要关闭系统级安全保护，也不要把
“仍要打开”理解为已通过 Apple 公证。

可在终端核对下载文件：

```bash
shasum -a 256 "Levil Notes 0.2.0.dmg"
cat "Levil Notes 0.2.0.dmg.sha256"
```

macOS 版复用同一份 React/TypeScript 前端和 Node 业务核心。Swift 只承载窗口、
系统菜单、WebView 桥接、原生文件动作、sidecar 生命周期和打包。

### macOS 从源码构建

需要安装 Xcode Command Line Tools、Node.js 18+ 和 Git：

```bash
xcode-select --install
git clone https://github.com/levil3/SpaceNotes.git
cd SpaceNotes
npm ci
bash scripts/build-macos-universal.sh
```

构建脚本固定使用 Node.js 24.22.1 的官方 arm64/x64 包，校验 SHA-256 后用 `lipo`
生成 universal Node，并检查 `.app` 内所有 Mach-O 都同时包含两种架构。

产物：

```text
build/macos/Levil Notes.app
build/macos/Levil Notes 0.2.0.dmg
build/macos/Levil Notes 0.2.0.dmg.sha256
build/macos/macho-architectures.txt
```

`.github/workflows/build-macos.yml` 可在 Actions 页面手动运行
`Build macOS Universal DMG`。arm64 任务构建 DMG；Intel 任务下载同一产物，挂载、
校验全部 Mach-O，并实际启动 x86_64 切片和 sidecar。

### macOS 设置与卸载

应用设置位于：

```text
~/Library/Application Support/Levil Notes/settings.json
```

卸载时先退出应用，再把 `Levil Notes.app` 移到废纸篓。笔记库不会随应用删除。
如需同时清除应用设置，可在确认不再需要后删除上述 `Levil Notes` 设置目录。

## 方式三：从源码运行

需要 Windows 10/11 x64、Node.js 18+、npm 和 Git。

```powershell
git clone https://github.com/levil3/SpaceNotes.git
cd SpaceNotes
npm ci
npm run dev
```

如果下载 Electron 失败，可以使用国内镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm ci
npm run dev
```

开发模式会启动 Vite 和 Electron。关闭 Electron 窗口后，开发命令会自动退出。

## 自行构建安装包

```powershell
npm ci
npm test
npm run build
```

构建完成后可以在以下位置找到文件：

```text
release/Levil Notes Setup 0.1.3.exe
release/win-unpacked/Levil Notes.exe
```

`win-unpacked` 中的版本可以免安装运行，适合调试。正式分发建议使用 Setup 安装包。

## 从 GitHub 自动生成安装包

仓库中的 `.github/workflows/build-windows.yml` 提供 Windows 自动构建：

- 在 Actions 页面手动运行 `Build Windows`，完成后下载 `windows-installer`。
- 推送 `v0.1.3` 这类标签后，工作流会构建并发布 GitHub Release。

维护者发布新版本时执行：

```powershell
git tag v0.1.3
git push origin v0.1.3
```

## 笔记库兼容性

- 笔记库就是普通的本地文件目录。
- 支持 Markdown 文件和本地附件。
- 可以直接打开 Obsidian 笔记库，`.obsidian` 等隐藏目录在开启“显示隐藏文件”后可见。
- SpaceNotes 不会改写笔记库的 `.gitignore`，Git 状态以仓库实际配置为准。
- 删除或卸载 SpaceNotes 不会删除笔记库。

## 卸载

打开 Windows“设置 > 应用 > 已安装的应用”，找到 `Levil Notes` 并选择卸载。
卸载程序只移除应用文件，不会删除你的笔记目录和其中的 Git 仓库。

如需同时清除应用设置，可以删除：

```text
%APPDATA%\levil-notes
```

## 常见问题

### 应用启动后打不开笔记目录

确认当前 Windows 用户具有该目录的读取和写入权限。网络盘或受 OneDrive 按需下载
影响的文件，建议先在资源管理器中设置为“始终保留在此设备上”。

### Git 面板没有显示变更

1. 确认目录内存在 `.git` 文件夹。
2. 在系统终端执行 `git -C <笔记目录> status`。
3. 确认文件没有被 `.gitignore` 忽略。
4. 检查 Git 是否已加入系统 `PATH`。

### 推送失败或提示认证错误

先在系统终端进入笔记目录，执行一次 `git push`。按照 Git Credential Manager 或
SSH 的提示完成登录。认证成功后再回到 SpaceNotes 重试。

### 更新后设置是否会丢失

正常覆盖安装会保留设置。设置存放在 `%APPDATA%\levil-notes`，与笔记库分离。

### 是否会上传笔记

应用本身不提供云端账号，也不会自动上传笔记。只有主动执行 Git 推送，或将笔记库
放在同步目录时，内容才可能离开本机。
