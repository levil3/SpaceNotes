# 通用 Node 与无签名 DMG 研究

日期：2026-10-23

分支：`research/universal-node-dmg`

范围：仅研究 ticket 05，不修改产品源码。

## 结论

方案可行：从 Node 官方分别下载 `darwin-arm64` 和 `darwin-x64` 包，用 Apple
`lipo` 合并一个通用 `node`，再把它和唯一的 React 构建、Swift WKWebView
宿主一起放进一个 universal `.app`，最后用 `hdiutil` 生成 DMG。

建议第一版固定 Node `24.22.1`，最低 macOS 版本暂按 `13.5` 设计。`13.5` 是
Node 24 官方支持的下限；如果产品必须支持 macOS 11 到 13.4，则应改用 Node 22，
并接受它将在 2027-04-30 结束维护。

无 Developer ID、无公证时，DMG 能生成和运行，但通过浏览器等下载渠道取得后，
其他 Mac 首次打开会触发 Gatekeeper。当前 Apple 官方路径是“隐私与安全性”中的
“仍要打开”，不能把
“右键打开”当作稳定验收标准。ad-hoc 签名可以保证包内代码签名自洽，但不能让
应用通过 Gatekeeper 的 Developer ID 策略。

本机实测 `24.22.1` 两个官方架构包合并成功，合并后的两个切片都能启动；但本次
尚未实现 Swift 宿主，所以完整的 WKWebView 应用仍需在实现后做双架构运行验证。

## 实测证据

研究机为 Apple Silicon Mac，macOS 27.0.1，Xcode 27.1。测试只使用临时目录：

```text
node-v24.22.1-darwin-arm64/bin/node: Mach-O 64-bit executable arm64
node-v24.22.1-darwin-x64/bin/node:   Mach-O 64-bit executable x86_64
node-universal:                      Mach-O universal binary [x86_64, arm64]
```

合并结果：

```text
$ lipo -archs node-universal
x86_64 arm64

$ ./node-universal --version
v24.22.1

$ arch -x86_64 ./node-universal --version
v24.22.1

$ arch -arm64 ./node-universal --version
v24.22.1
```

通用 `node` 未压缩大小约 236 MiB。Node 24 只动态链接系统框架和系统库；
`otool -L` 在两个切片中看到的都是 `CoreFoundation`、`Security`、
`libc++` 和 `libSystem`。

当前生产依赖中的可选原生模块 `fsevents@2.3.3` 本身是 universal Mach-O，
`x86_64` 和 `arm64` 都存在。任何新增原生模块仍必须逐项检查，不能因为当前
这个模块可用就跳过扫描。

## 1. Node 官方包与通用二进制

Node 官方没有单一的 macOS universal tarball，而是分开发布
`node-v24.22.1-darwin-arm64.tar.gz` 和
`node-v24.22.1-darwin-x64.tar.gz`。这不构成阻塞；Apple 明确说明可以用
`lipo` 把两次架构构建合并为一个 universal 文件。

推荐命令：

```bash
set -euo pipefail

NODE_VERSION=24.22.1
NODE_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
WORK="$(mktemp -d)"

cd "$WORK"
curl -fLO "$NODE_BASE/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
curl -fLO "$NODE_BASE/node-v${NODE_VERSION}-darwin-x64.tar.gz"
curl -fLO "$NODE_BASE/SHASUMS256.txt"
shasum -a 256 -c SHASUMS256.txt --ignore-missing

tar -xzf "node-v${NODE_VERSION}-darwin-arm64.tar.gz"
tar -xzf "node-v${NODE_VERSION}-darwin-x64.tar.gz"

lipo -create \
  "node-v${NODE_VERSION}-darwin-arm64/bin/node" \
  "node-v${NODE_VERSION}-darwin-x64/bin/node" \
  -output "$WORK/node"

chmod 755 "$WORK/node"
lipo -archs "$WORK/node"
```

当前官方 SHA-256：

```text
89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7  node-v24.22.1-darwin-arm64.tar.gz
d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035  node-v24.22.1-darwin-x64.tar.gz
```

只复制 `bin/node`。官方包里的 `npm`、`npx`、`corepack` 是构建工具，不需要进入
最终应用；sidecar 应直接由 `node` 启动。

本次测试中，`lipo` 合并后 Node Foundation 的 Developer ID 签名仍然有效：

```text
$ codesign --verify --strict node-universal
node-universal: valid on disk
```

不要依赖这一行为。任何后续修改都可能使签名失效，因此合并后至少要执行：

```bash
codesign --verify --strict "$NODE"
```

如果失败，在任何最终打包步骤之前重新签名。无 Developer ID 的第一版可以
ad-hoc 签名：

```bash
codesign --force --sign - --timestamp=none "$NODE"
```

这不是“已签名分发”。`codesign` 手册明确说明 `-` 只是 ad-hoc 身份；
Apple 的公证流程要求 Developer ID，ad-hoc 不能完成公证。

## 2. Node 版本、动态库和原生依赖

建议固定精确版本 `24.22.1`，不要使用浮动的 `24` 或 runner 自带 Node。

选择依据：

- `24.22.1` 是 2026-10-23 时 Node 官网列出的最新 LTS 版本。
- Node 24 于 2026-10-20 进入 Maintenance LTS，但维护期持续到 2028-04-30。
- Node 24 官方 macOS arm64/x64 支持下限是 macOS 13.5，官方构建使用
  Xcode 16 和 `-mmacosx-version-min=13.5`。
- Node 22 的 macOS 下限是 11.0，但维护期只到 2027-04-30，不适合作为新包的
  长期基线。
- 现有项目使用 Electron 30，但 macOS 目标是 WKWebView 外壳加独立 Node
  sidecar；sidecar 的 ABI 来自 Node，而不是 Electron 内嵌运行时。

因此，最低 macOS 版本建议与 Node 24 对齐为 13.5。如果 ticket 06 最终要求
支持更低的 macOS，那么不能沿用 Node 24；应改为 Node 22 并重新评估生命周期。

typescript 构建和测试也应固定到 Node 24.22.1。现有的 `@types/node` 22 不决定
真实运行时，但实现阶段应同步到 24，避免类型声明和实际 API 不一致。

Node 本体不需要额外复制动态库。CI 仍应检查：

```bash
otool -arch arm64 -L "$NODE"
otool -arch x86_64 -L "$NODE"
```

输出中不应出现指向 bundle 外、非 `/System`、`/usr/lib` 或 `/Library` 的绝对路径。

原生模块是另一类问题。`.node` 文件是 Mach-O bundle，不会因为 Node 是 universal
而自动变成 universal。当前 `fsevents@2.3.3` 是双架构，但以后新增模块时必须：

1. 分别取得或构建 `arm64` 与 `x86_64` 版本。
2. 用 `lipo` 合并，或者删除可选依赖并确认有纯 JS 回退路径。
3. 对最终 `.app` 内所有 Mach-O 再扫描一次。

本项目的 `chokidar@3.6.0` 将 `fsevents@2.3.3` 作为 macOS 可选依赖。如果未来
选择 `--omit=optional`，功能会退回到非 FSEvents 的文件轮询路径；这属于行为差异，
不能只以“应用能启动”作为通过标准。

## 3. 推荐 `.app/Contents` 布局

第一版建议：

```text
Levil Notes.app/
  Contents/
    Info.plist
    MacOS/
      Levil Notes
      node
    Resources/
      web/
        index.html
        assets/
      sidecar/
        main.cjs
        package.json
        node_modules/
          ...
```

放置原则：

- Swift 主程序放在 `Contents/MacOS/`。
- 通用 `node` 也放在 `Contents/MacOS/`，由 Swift `Process` 直接启动。
- React 的 `dist/` 作为静态资源整体复制到 `Contents/Resources/web/`。
- sidecar 的 JS、`package.json` 和生产依赖放在 `Contents/Resources/sidecar/`。
- `node_modules` 中只保留运行时依赖，不复制 TypeScript、Vite、Electron、
  Electron Builder、测试框架等开发依赖。
- WKWebView 通过 `Bundle.main` 找到 `Resources/web`，不能使用仓库的绝对路径。
- 不复制第二个 React 构建，也不在运行时启动 Electron。

当前 `fsevents.node` 会随生产依赖进入 `Resources`。对无签名第一版这是可运行的，
但 Apple 的 bundle 文档要求 Mach-O 代码放在代码位置，并指出错误放置可能在
公证时暴露问题。第一版不做公证，因此可以接受；后续启用 Developer ID 时，应优先
评估把 sidecar 提升为 `Contents/Helpers/` 下的辅助 `.app`，并对所有嵌套 Mach-O
逐个签名、查看公证日志。

Swift 启动 sidecar 时使用 bundle 相对路径，例如
`Bundle.main.url(forAuxiliaryExecutable: "node")`，工作目录显式设为
`Contents/Resources/sidecar`。不要依赖用户当前 shell 的 PATH。

## 4. 一个 universal `.app` 和一个 DMG

可以只放一个 `.app`。DMG 是文件容器，本身没有 arm64/x86_64 架构概念；真正的
条件是该 `.app` 内所有可能在两种硬件上执行的 Mach-O 都含双架构。

推荐的 DMG 目录：

```text
Levil Notes.dmg
  Levil Notes.app
  Applications -> /Applications
```

`Applications` 是 DMG 顶层符号链接，不是 `.app` 内部链接。

构建命令：

```bash
set -euo pipefail

DMG_ROOT="$(mktemp -d)"
DMG="$(mktemp -d)/Levil-Notes.dmg"

ditto "$APP" "$DMG_ROOT/Levil Notes.app"
ln -s /Applications "$DMG_ROOT/Applications"

hdiutil create \
  -volname "Levil Notes" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  "$DMG"

hdiutil verify "$DMG"
shasum -a 256 "$DMG"
```

`hdiutil create -srcfolder` 会复制目录内容并生成文件系统；
`UDZO` 是压缩只读 DMG。

挂载验收：

```bash
MOUNT="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG"
test -d "$MOUNT/Levil Notes.app"
test -L "$MOUNT/Applications"
hdiutil detach "$MOUNT"
```

## 5. 架构校验

先完成所有架构相关产物，再对所有最终 Mach-O 做统一检查：

```bash
#!/usr/bin/env bash
set -euo pipefail

APP="$1"
bad=0

while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q '^Mach-O'; then
    archs="$(lipo -archs "$file")"
    printf '%s: %s\n' "$file" "$archs"
    if [[ "$archs" != *arm64* || "$archs" != *x86_64* ]]; then
      printf 'NOT UNIVERSAL: %s\n' "$file" >&2
      bad=1
    fi
  fi
done < <(find "$APP" -type f -print0)

if [[ "$bad" -ne 0 ]]; then
  exit 1
fi
```

顺序不能假定为固定值；Apple `lipo -archs` 可能输出 `x86_64 arm64`，也可能输出
`arm64 x86_64`。

运行时冒烟测试：

```bash
NODE="$APP/Contents/MacOS/node"

arch -x86_64 "$NODE" -e 'console.log(process.version, process.arch)'
arch -arm64 "$NODE" -e 'console.log(process.version, process.arch)'
```

在 Apple Silicon 上跑 `x86_64` 切片需要 Rosetta；在 Intel runner 上跑
`arm64` 切片不可行。因此 CI 应分别在 Intel 与 arm64 runner 上验证，而不是
只在一个 runner 上强行运行两个切片。

`codesign` 只能验证签名完整性，不验证架构。架构检查和签名检查都要执行。

## 6. Swift 构建与签名顺序

Xcode Release 构建默认可以生成 universal；显式固定参数更可复现：

```bash
xcodebuild \
  -project macos/LevilNotes.xcodeproj \
  -scheme LevilNotes \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "$BUILD/DerivedData" \
  ARCHS='arm64 x86_64' \
  ONLY_ACTIVE_ARCH=NO \
  MACOSX_DEPLOYMENT_TARGET=13.5 \
  CODE_SIGNING_ALLOWED=NO \
  build
```

实际项目名和 scheme 在实现时替换。`CODE_SIGNING_ALLOWED=NO` 只避免 Xcode
要求开发者证书；打包前仍需处理嵌套 Mach-O 与 bundle 的 ad-hoc 签名。

建议顺序：

1. 完成所有文件复制和资源替换。
2. 对 `node` 及所有 `.node` Mach-O 执行 ad-hoc 签名。
3. 最后签外层 `.app`。
4. 用 `codesign --verify --deep --strict` 验证。
5. 再创建 DMG，签名后不要再修改 `.app`。

示例：

```bash
while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q '^Mach-O'; then
    codesign --force --sign - --timestamp=none "$file"
  fi
done < <(find "$APP" -type f -print0)

codesign --force --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
```

这里没有使用 `--deep` 签名。Apple 文档建议先签最深层代码，再逐层签外层；
`--deep` 更适合验证，不是常规签名方式。

## 7. Gatekeeper 与“右键打开”

Apple 说明 macOS 会检查从 App Store 之外下载的软件是否有 Developer ID 签名，
macOS Catalina 以后还要求公证。无签名、无公证的应用仍可运行，但用户必须手动
绕过首次启动警告。

当前 Apple 支持文档给出的流程是：

1. 首次尝试打开应用。
2. 打开“系统设置 > 隐私与安全性”。
3. 在“安全性”区域点击“打开”（Open），再点击“仍要打开”（Open Anyway）。
4. 输入登录密码并确认。
5. 该应用被保存为例外，之后可以正常双击打开。

“仍要打开”按钮在首次尝试后大约一小时内可用。当前官方文档没有把
Control-click/右键打开列为可靠流程；某些 macOS 版本可能仍可用，但产品说明和
验收不应依赖它。

重要边界：

- `codesign --sign -` 是 ad-hoc 签名，不是 Developer ID。
- ad-hoc 签名可以通过 `codesign --verify`，但仍会被 Gatekeeper 的默认策略拒绝。
- `spctl --assess --type execute --verbose=4 "$APP"` 对无 Developer ID 的应用
  返回非零是预期结果，不能把它当作 CI 失败。
- `spctl` 的判定受本机安全设置和本地规则影响，不能替代真实的首次启动测试。
- Gatekeeper 只检查被 quarantine 的文件；用 `curl` 直接下载 DMG 通常不会设置
  quarantine，因此不能证明“从浏览器下载后能打开”。
- 无签名 DMG 是否被拦截需要在一台干净的 Mac 上用 Safari 或 Chrome 从实际
  Release 地址下载，再拖入 `/Applications` 测试。
- GitHub Actions runner 无法替代人工确认交互式 Gatekeeper 对话框。

不要在应用启动流程中自动删除 `com.apple.quarantine`，也不要把它写成默认用户
步骤。内部 QA 若使用 `xattr -dr com.apple.quarantine`，应明确标记为降低安全
保护的测试手段，而不是产品安装说明。

## 8. 本地可复现构建清单

建议使用以下顺序：

```bash
set -euo pipefail

NODE_VERSION=24.22.1
BUILD="$(mktemp -d)"
APP="$BUILD/Levil Notes.app"

# 1. 固定 Node 工具链构建 React。
npm ci
npm test
npm run build:web

# 2. 构建 Swift 宿主。
xcodebuild \
  -project macos/LevilNotes.xcodeproj \
  -scheme LevilNotes \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "$BUILD/DerivedData" \
  ARCHS='arm64 x86_64' \
  ONLY_ACTIVE_ARCH=NO \
  MACOSX_DEPLOYMENT_TARGET=13.5 \
  CODE_SIGNING_ALLOWED=NO \
  build

PRODUCT_APP="$BUILD/DerivedData/Build/Products/Release/Levil Notes.app"
ditto "$PRODUCT_APP" "$APP"

# 3. 复制唯一 React 构建和 sidecar 源。
ditto dist "$APP/Contents/Resources/web"
mkdir -p "$APP/Contents/Resources/sidecar"
cp package.json package-lock.json "$APP/Contents/Resources/sidecar/"
ditto electron "$APP/Contents/Resources/sidecar/electron"
npm ci --omit=dev --prefix "$APP/Contents/Resources/sidecar"

# 4. 下载、校验并合并 Node。
NODE_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
NODE_TMP="$(mktemp -d)"
(
  cd "$NODE_TMP"
  curl -fLO "$NODE_BASE/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
  curl -fLO "$NODE_BASE/node-v${NODE_VERSION}-darwin-x64.tar.gz"
  curl -fLO "$NODE_BASE/SHASUMS256.txt"
  shasum -a 256 -c SHASUMS256.txt --ignore-missing
  tar -xzf "node-v${NODE_VERSION}-darwin-arm64.tar.gz"
  tar -xzf "node-v${NODE_VERSION}-darwin-x64.tar.gz"
  lipo -create \
    "node-v${NODE_VERSION}-darwin-arm64/bin/node" \
    "node-v${NODE_VERSION}-darwin-x64/bin/node" \
    -output node
)
install -m 755 "$NODE_TMP/node" "$APP/Contents/MacOS/node"

# 5. 架构检查、ad-hoc 签名、DMG。
# 这里调用报告前面的通用 Mach-O 检查脚本。
# ... sign nested Mach-O, sign app, verify ...
```

若实际 sidecar 入口不是 `electron` 目录中的脚本，只替换复制路径，不改变布局原则。

## 9. GitHub Actions macOS runner 约束

根据 2026-10-23 的 GitHub 官方 runner 文档：

- `macos-15` 是 arm64，3 CPU M1、7 GB RAM、14 GB SSD。
- `macos-15-intel` 是 Intel，4 CPU、14 GB RAM、14 GB SSD。
- `macos-26` 是 arm64；`macos-26-intel` 是 Intel。
- `macos-latest` 当前指向 macOS 26 arm64，不要用它锁定构建环境。
- macOS 14 已进入弃用周期，不应作为新流水线基线。
- macOS 15 镜像默认 Xcode 16.4，满足 Node 24 官方构建与 universal Swift
  构建的最低工具链要求。
- arm64 runner 上的社区 action 可能不兼容；优先使用 GitHub 官方 action。
- Intel runner 内存更多，适合作为通用包构建机；arm64 runner 用于实际运行
  arm64 切片。

建议两个 job：

```yaml
jobs:
  build:
    runs-on: macos-15-intel
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24.22.1
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build:web
      # xcodebuild universal, stage sidecar, lipo node, ad-hoc sign, hdiutil
      - run: ./scripts/verify-macos-bundle.sh "release/Levil Notes.app"
      - uses: actions/upload-artifact@v4
        with:
          name: macos-dmg
          path: release/*.dmg
          if-no-files-found: error

  smoke-arm64:
    needs: build
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v5
      - uses: actions/download-artifact@v4
        with:
          name: macos-dmg
      - run: |
          set -euo pipefail
          DMG="$(find . -name '*.dmg' -print -quit)"
          MOUNT="$(mktemp -d)"
          hdiutil verify "$DMG"
          hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG"
          trap 'hdiutil detach "$MOUNT"' EXIT
          ./scripts/verify-macos-bundle.sh "$MOUNT/Levil Notes.app"
          "$MOUNT/Levil Notes.app/Contents/MacOS/node" \
            -e 'console.log(process.version, process.arch)'
```

第二个 job 从 DMG 挂载后的 `.app` 验证 arm64 切片。若要从 Intel job 验证
arm64 架构，只能做静态 `lipo` 检查；真正的 arm64 执行必须放到 arm64 runner
或 Apple Silicon 实机。

无签名方案不需要在 CI 配置 Developer ID 证书、Apple ID 或公证密钥。不得为了
“让 CI 成功”而加入 `spctl --master-disable` 或关闭 Gatekeeper。

## 10. 未决问题

- 最低 macOS 版本尚未由 ticket 06 决定。固定 Node 24 意味着当前建议基线为
  13.5；如果必须支持更低版本，需要重新选择 Node 22 并接受更短维护期。
- 目前只验证了 Node 本体与 `fsevents`，还没有实现 Swift WKWebView 宿主；
  Xcode universal 构建、WKWebView 加载 `file://` 资源和 sidecar 启动仍需原型验证。
- sidecar 的最终入口、生产依赖集合和是否需要额外原生模块尚未确定；实现后必须
  重新运行完整 Mach-O 扫描。
- Gatekeeper 的交互式体验会随 macOS 大版本变化，当前支持文案必须先通过
  macOS 13.5、15 和 26 的干净实机测试，再进入 ticket 06。
- GitHub runner 标签会演进；`macos-15-intel` 只是当前可用基线，发布流水线应
  固定标签并设置定期更新检查，不要依赖 `macos-latest`。
- 无签名 DMG 的浏览器下载、quarantine、拖入 `/Applications` 和“仍要打开”
  流程尚未在实际 Release 地址上验证。

## 主要官方资料

- Apple，Building a universal macOS binary：
  https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary
- Apple，Placing content in a bundle：
  https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- Apple，Notarizing macOS software before distribution：
  https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple，Open a Mac app from an unknown developer：
  https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac
- Apple，Safely open apps on your Mac：
  https://support.apple.com/en-us/102445
- Apple，Code Signing Guide：
  https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html
- Apple 本地手册页：`man lipo`、`man codesign`、`man hdiutil`
- Node.js 下载与校验：
  https://nodejs.org/dist/v24.22.1/
  https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
- Node.js Releases：
  https://nodejs.org/en/about/previous-releases
- Node.js release schedule：
  https://github.com/nodejs/Release/blob/main/schedule.json
- Node.js 24 build requirements：
  https://github.com/nodejs/node/blob/v24.22.1/BUILDING.md
- Node.js `process.arch`：
  https://nodejs.org/api/process.html#processarch
- GitHub-hosted runners：
  https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- macOS 15 Intel runner image：
  https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md
- macOS 15 arm64 runner image：
  https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md
