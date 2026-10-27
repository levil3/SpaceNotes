#!/bin/bash
set -euo pipefail

# 构建 macOS .app 与 DMG。
# 用法: build-macos.sh [--arch arm64|x64|universal]
#   不带参数        构建当前机器架构
#   --arch arm64    Apple Silicon 专用包
#   --arch x64      Intel 专用包
#   --arch universal 双架构通用包（lipo 合成 Node，等同旧 build-universal.sh 行为）

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS_ROOT="$ROOT/macos"
BUILD_ROOT="$ROOT/build/macos"
CACHE_ROOT="${SPACENOTES_MACOS_CACHE:-$ROOT/.cache/macos}"
NODE_VERSION="24.22.1"
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$ROOT/package.json")"
VERSION="${VERSION#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "invalid macOS version: $VERSION" >&2
  exit 1
fi
BUILD_VERSION="${SPACENOTES_BUILD_VERSION:-2}"
APP_PATH="$BUILD_ROOT/Levil Notes.app"

TARGET_ARCH="$(uname -m)"
if [[ "$TARGET_ARCH" == "x86_64" ]]; then
  TARGET_ARCH="x64"
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      if [[ $# -lt 2 ]]; then
        echo "--arch 需要参数 arm64|x64|universal" >&2
        exit 1
      fi
      TARGET_ARCH="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1（用法: build-macos.sh [--arch arm64|x64|universal]）" >&2
      exit 1
      ;;
  esac
done
case "$TARGET_ARCH" in
  arm64|x64|universal) ;;
  *)
    echo "无效架构: $TARGET_ARCH（可选 arm64|x64|universal）" >&2
    exit 1
    ;;
esac

if [[ "$TARGET_ARCH" == "universal" ]]; then
  NODE_ARCHES=(arm64 x64)
  DMG_SUFFIX=""
  SWIFT_ARCH_FLAGS=(--arch arm64 --arch x86_64)
else
  NODE_ARCHES=("$TARGET_ARCH")
  DMG_SUFFIX="-${TARGET_ARCH}"
  if [[ "$TARGET_ARCH" == "arm64" ]]; then
    SWIFT_ARCH_FLAGS=(--arch arm64)
  else
    SWIFT_ARCH_FLAGS=(--arch x86_64)
  fi
fi
DMG_PATH="$BUILD_ROOT/Levil Notes $VERSION${DMG_SUFFIX}.dmg"
DMG_SHA_PATH="$DMG_PATH.sha256"
MANIFEST_PATH="$BUILD_ROOT/macho-architectures${DMG_SUFFIX}.txt"
NODE_STAGING="$BUILD_ROOT/node-${TARGET_ARCH}"

mkdir -p "$BUILD_ROOT" "$CACHE_ROOT"

retry_hdiutil() {
  local operation="$1"
  local attempts="$2"
  local delay_seconds="$3"
  shift 3
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if hdiutil "$operation" "$@"; then
      return 0
    fi
    if ((attempt == attempts)); then
      echo "hdiutil $operation failed after $attempts attempts" >&2
      return 1
    fi
    echo "hdiutil $operation attempt $attempt/$attempts failed; retrying" >&2
    sleep "$delay_seconds"
  done
  return 1
}

mount_point_is_active() {
  mount | grep -F " on $mount_point " >/dev/null 2>&1
}

detach_mount_point() {
  local attempts=3
  local delay_seconds=1
  local attempt

  if ! mount_point_is_active; then
    return 0
  fi
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    if ! mount_point_is_active; then
      return 0
    fi
    sleep "$delay_seconds"
  done
  return 1
}

attach_dmg() {
  local attempts=5
  local delay_seconds=2
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if hdiutil attach -quiet -readonly -nobrowse \
      -mountpoint "$mount_point" "$DMG_PATH"; then
      return 0
    fi
    if ! detach_mount_point; then
      echo "cannot safely retry hdiutil attach with a dirty mount point" >&2
      return 1
    fi
    if ((attempt == attempts)); then
      echo "hdiutil attach failed after $attempts attempts" >&2
      return 1
    fi
    echo "hdiutil attach attempt $attempt/$attempts failed; retrying" >&2
    sleep "$delay_seconds"
  done
  return 1
}

download_node() {
  local architecture="$1"
  local archive="node-v${NODE_VERSION}-darwin-${architecture}.tar.xz"
  if [[ ! -f "$CACHE_ROOT/$archive" ]]; then
    curl --fail --location --retry 3 \
      "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" \
      --output "$CACHE_ROOT/$archive"
  fi
  if [[ ! -d "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-${architecture}" ]]; then
    tar -xJf "$CACHE_ROOT/$archive" -C "$CACHE_ROOT"
  fi
}

if [[ ! -f "$CACHE_ROOT/SHASUMS256.txt" ]]; then
  curl --fail --location --retry 3 \
    "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    --output "$CACHE_ROOT/SHASUMS256.txt"
fi

for node_arch in "${NODE_ARCHES[@]}"; do
  download_node "$node_arch"
done
(
  cd "$CACHE_ROOT"
  arch_alternation="$(IFS='|'; echo "${NODE_ARCHES[*]}")"
  grep -E " node-v${NODE_VERSION}-darwin-(${arch_alternation})\\.tar\\.xz$" \
    SHASUMS256.txt | shasum -a 256 -c -
)

rm -rf "$NODE_STAGING" "$APP_PATH" "$BUILD_ROOT/dmg-stage"
mkdir -p "$NODE_STAGING"
if [[ "$TARGET_ARCH" == "universal" ]]; then
  lipo -create \
    "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-arm64/bin/node" \
    "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-x64/bin/node" \
    -output "$NODE_STAGING/node"
else
  cp "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-${TARGET_ARCH}/bin/node" \
    "$NODE_STAGING/node"
fi
chmod +x "$NODE_STAGING/node"

if [[ "$TARGET_ARCH" == "arm64" || "$TARGET_ARCH" == "universal" ]]; then
  arm64_output="$(arch -arm64 "$NODE_STAGING/node" -p process.arch)"
  [[ "$arm64_output" == "arm64" ]]
fi
if [[ "$TARGET_ARCH" == "x64" || "$TARGET_ARCH" == "universal" ]]; then
  x64_output="$(arch -x86_64 "$NODE_STAGING/node" -p process.arch)"
  [[ "$x64_output" == "x64" ]]
fi

(
  cd "$ROOT"
  npm run build:web
)
(
  cd "$MACOS_ROOT"
  swift test
  swift build -c release "${SWIFT_ARCH_FLAGS[@]}"
)
SWIFT_BIN_PATH="$(
  cd "$MACOS_ROOT"
  swift build -c release "${SWIFT_ARCH_FLAGS[@]}" --show-bin-path
)"
test -x "$SWIFT_BIN_PATH/SpaceNotes"
bash "$MACOS_ROOT/native/build-fs-helper.sh" \
  "$BUILD_ROOT/space-notes-fs" "$TARGET_ARCH"

rm -rf "$BUILD_ROOT/sidecar-runtime"
mkdir -p "$BUILD_ROOT/sidecar-runtime"
cp "$MACOS_ROOT/sidecar/package.json" "$BUILD_ROOT/sidecar-runtime/"
cp "$MACOS_ROOT/sidecar/package-lock.json" "$BUILD_ROOT/sidecar-runtime/"
(
  cd "$BUILD_ROOT/sidecar-runtime"
  npm ci --omit=dev --omit=optional --ignore-scripts
)

rm -rf "$BUILD_ROOT/icon.iconset"
mkdir -p "$BUILD_ROOT/icon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ROOT/resources/icon.png" \
    --out "$BUILD_ROOT/icon.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ROOT/resources/icon.png" \
    --out "$BUILD_ROOT/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$BUILD_ROOT/icon.iconset" \
  -o "$BUILD_ROOT/LevilNotes.icns"

mkdir -p \
  "$APP_PATH/Contents/MacOS" \
  "$APP_PATH/Contents/Resources/web" \
  "$APP_PATH/Contents/Resources/sidecar/electron" \
  "$APP_PATH/Contents/Resources/sidecar/macos/sidecar"
cp "$SWIFT_BIN_PATH/SpaceNotes" \
  "$APP_PATH/Contents/MacOS/SpaceNotes"
cp "$NODE_STAGING/node" "$APP_PATH/Contents/Resources/node"
cp -R "$ROOT/dist/." "$APP_PATH/Contents/Resources/web/"
cp "$MACOS_ROOT/bridge/levilNotesBridge.js" \
  "$APP_PATH/Contents/Resources/levilNotesBridge.js"
cp "$ROOT/electron/api.cjs" "$ROOT/electron/git.cjs" \
  "$ROOT/electron/vault.cjs" \
  "$APP_PATH/Contents/Resources/sidecar/electron/"
cp "$MACOS_ROOT/sidecar/sidecar-entry.cjs" \
  "$MACOS_ROOT/sidecar/server.cjs" \
  "$MACOS_ROOT/sidecar/file-operations.cjs" \
  "$APP_PATH/Contents/Resources/sidecar/macos/sidecar/"
cp "$BUILD_ROOT/space-notes-fs" \
  "$APP_PATH/Contents/Resources/sidecar/space-notes-fs"
cp "$BUILD_ROOT/sidecar-runtime/package.json" \
  "$APP_PATH/Contents/Resources/sidecar/"
cp -R "$BUILD_ROOT/sidecar-runtime/node_modules" \
  "$APP_PATH/Contents/Resources/sidecar/"
cp "$BUILD_ROOT/LevilNotes.icns" \
  "$APP_PATH/Contents/Resources/LevilNotes.icns"
cp "$MACOS_ROOT/web/macos.css" \
  "$APP_PATH/Contents/Resources/macos.css"

cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>Levil Notes</string>
  <key>CFBundleExecutable</key>
  <string>SpaceNotes</string>
  <key>CFBundleIconFile</key>
  <string>LevilNotes</string>
  <key>CFBundleIdentifier</key>
  <string>com.levil.notes</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>CFBundleName</key>
  <string>Levil Notes</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.5</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST
plutil -replace CFBundleShortVersionString -string "$VERSION" \
  "$APP_PATH/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$BUILD_VERSION" \
  "$APP_PATH/Contents/Info.plist"
printf 'APPL????' > "$APP_PATH/Contents/PkgInfo"

plutil -lint "$APP_PATH/Contents/Info.plist"
codesign --force --deep --sign - "$APP_PATH"
"$MACOS_ROOT/scripts/verify-bundle.sh" \
  "$APP_PATH" "$MANIFEST_PATH" "$TARGET_ARCH"

mkdir -p "$BUILD_ROOT/dmg-stage"
cp -R "$APP_PATH" "$BUILD_ROOT/dmg-stage/"
ln -s /Applications "$BUILD_ROOT/dmg-stage/Applications"
hdiutil create -quiet -ov \
  -volname "Levil Notes" \
  -srcfolder "$BUILD_ROOT/dmg-stage" \
  -format UDZO \
  "$DMG_PATH"
retry_hdiutil verify 5 2 "$DMG_PATH"

mount_point="$BUILD_ROOT/dmg-mount"
rm -rf "$mount_point"
mkdir -p "$mount_point"
cleanup() {
  detach_mount_point || true
}
trap cleanup EXIT
attach_dmg
test -d "$mount_point/Levil Notes.app"
test -L "$mount_point/Applications"

(
  cd "$BUILD_ROOT"
  shasum -a 256 "$(basename "$DMG_PATH")"
) | tee "$DMG_SHA_PATH"
echo "构建完成（${TARGET_ARCH}）：$DMG_PATH"
