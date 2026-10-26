# SpaceNotes

**Language / 语言:** [简体中文](README.md) | [English](README.en.md)

SpaceNotes is a local-first Markdown notes application for Windows and macOS. It
opens ordinary Markdown folders and existing Obsidian vaults, bringing editing,
search, outlines, backlinks, and Git workflows into one desktop interface.

![SpaceNotes interface preview](docs/images/spacenotes-preview.png)

## Download and install

Download the latest Windows installer `Levil Notes Setup x.y.z.exe` or the
universal macOS DMG `Levil Notes x.y.z.dmg` from
[Releases](https://github.com/levil3/SpaceNotes/releases). See the
[installation guide (Simplified Chinese)](docs/INSTALL.md) for additional setup
and troubleshooting notes.

On first launch, select an existing notes folder or create an empty folder as a
vault. Your vault remains an ordinary directory: existing Obsidian repositories,
Markdown files, and Git history can continue to be used in place.

## Features

- Live Markdown editing with a reading-first default and an editing mode.
- File tree, title and full-text search, smart and exact matching, tags,
  backlinks, and a collapsible outline.
- Multiple editor tabs, autosave, in-note `Ctrl+F`, and editor appearance
  settings.
- Relative attachment paths from the vault, the current note, and older notes.
- Local images, tables, syntax-highlighted code blocks, light and dark
  appearances, and common editor themes.
- IntelliJ IDEA-style Git status colors, diff preview, staging, commit, pull, and
  push.
- `.gitignore` support, a hidden-file toggle, and ignore actions for individual
  folders or files.
- SpaceNotes uses the system Git installation, so existing credential helpers,
  SSH, proxy, and hook configuration continue to apply.

## Requirements

- Windows 10/11 x64.
- macOS 13.5 or later, on Intel or Apple Silicon.
- A system Git installation when using Git features.
- Node.js 18 or later when running from source or building.

## Run from source

The commands below work on Windows and macOS. Install Node.js 18+, npm, and Git
first. Building the native macOS shell also requires Xcode Command Line Tools.

### Shared frontend and business-logic development

Windows PowerShell:

```powershell
git clone https://github.com/levil3/SpaceNotes.git
cd SpaceNotes
npm ci
npm run dev
```

macOS Terminal:

```bash
git clone https://github.com/levil3/SpaceNotes.git
cd SpaceNotes
npm ci
npm run dev
```

`npm run dev` starts the shared Vite and Electron development host. On macOS it
also builds the native file helper, but this is not the production AppKit +
WKWebView shell.

If Electron downloads are slow, configure a mirror before installing
dependencies.

Windows PowerShell:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm ci
```

macOS Terminal:

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm ci
```

### Native macOS shell

Test the Swift code and build a runnable `.app`:

```bash
cd macos
swift test
cd ..
bash macos/scripts/build-universal.sh
open "build/macos/Levil Notes.app"
```

The first build downloads and verifies separate arm64 and x64 Node.js runtimes.
The complete DMG is written to
`build/macos/Levil Notes <package.json version>.dmg`.

## Verify and build

Shared verification:

```bash
npm test
npm run build:web
```

### Windows installer

```powershell
npm run build
```

- `npm run build` builds the Windows x64 NSIS installer.
- Installer output: `release/`
- Portable debug build: `release/win-unpacked/Levil Notes.exe`

### Universal macOS DMG

```bash
npm ci
bash macos/scripts/build-universal.sh
```

- `npm run build:web` runs the TypeScript check and builds the frontend assets.
- `build-universal.sh` builds the Intel and Apple Silicon `.app` and DMG.
- Output directory: `build/macos/`

The repository includes automated Windows and macOS builds. The root
`package.json` is the only application version source. A `v*` tag must exactly
match that version to trigger `Release Desktop`, which builds the Windows x64
and macOS universal products in parallel and publishes them atomically after
both platforms pass verification.

The macOS application uses a thin AppKit + WKWebView shell with an embedded Node
sidecar. Its DMG directory also contains the SHA-256 checksum and a complete
Mach-O architecture manifest. The `Build macOS Universal DMG` workflow builds on
an arm64 runner, then mounts the same DMG on an Intel runner to verify every
machine architecture and start the x86_64 slice.

## Data and permissions

- Notes always remain in the local folder you select.
- The application never commits, pushes, force-pulls, or silently merges on its
  own.
- The renderer has no Node.js or unrestricted filesystem access. File and Git
  operations cross a restricted host interface.
- Git changes are unselected by default. A commit is blocked when pre-staged
  content is not selected, preventing accidental commits.
- Settings live in the host application's user-data directory, not in the vault.

## Project structure

```text
electron/main.cjs       Electron lifecycle, windows, protocols, and IPC
electron/preload.cjs    Restricted IPC API
electron/vault.cjs      Vault index, search, attachments, and settings
electron/git.cjs        System Git CLI integration
macos/                  AppKit + WKWebView, sidecar, DMG scripts, and tests
src/App.tsx             Application state, tabs, and workspace orchestration
src/components/         UI components and side panels
src/lib/markdown.ts     Editor image URLs and Markdown round-tripping
```

## Current scope

- Plugins, graph views, Canvas, mobile clients, and real-time multi-device
  collaboration are not implemented.
- Automatic merges, force pushes, automatic commits, and cloud accounts are not
  supported.
- Conflicts are visible in the interface, but must currently be resolved
  through a normal Git workflow.

See [docs/INSTALL.md](docs/INSTALL.md) for the detailed setup, installation,
uninstallation, and troubleshooting guide. The guide is currently written in
Simplified Chinese.
