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

## 方式二：从源码运行

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
release/Levil Notes Setup 0.1.0.exe
release/win-unpacked/Levil Notes.exe
```

`win-unpacked` 中的版本可以免安装运行，适合调试。正式分发建议使用 Setup 安装包。

## 从 GitHub 自动生成安装包

仓库中的 `.github/workflows/build-windows.yml` 提供 Windows 自动构建：

- 在 Actions 页面手动运行 `Build Windows`，完成后下载 `windows-installer`。
- 推送 `v0.1.0` 这类标签后，工作流会构建并发布 GitHub Release。

维护者发布新版本时执行：

```powershell
git tag v0.1.0
git push origin v0.1.0
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
