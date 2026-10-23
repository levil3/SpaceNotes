#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_ROOT="$ROOT/macos"
BUILD_ROOT="$ROOT/build/macos"
CACHE_ROOT="${SPACENOTES_MACOS_CACHE:-$ROOT/.cache/macos}"
NODE_VERSION="24.22.1"
APP_PATH="$BUILD_ROOT/Levil Notes.app"
DMG_PATH="$BUILD_ROOT/Levil Notes 0.2.0.dmg"

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

download_node arm64
download_node x64
(
  cd "$CACHE_ROOT"
  grep -E " node-v${NODE_VERSION}-darwin-(arm64|x64)\\.tar\\.xz$" \
    SHASUMS256.txt | shasum -a 256 -c -
)

rm -rf "$BUILD_ROOT/node-universal" "$APP_PATH" "$BUILD_ROOT/dmg-stage"
mkdir -p "$BUILD_ROOT/node-universal"
lipo -create \
  "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-arm64/bin/node" \
  "$CACHE_ROOT/node-v${NODE_VERSION}-darwin-x64/bin/node" \
  -output "$BUILD_ROOT/node-universal/node"
chmod +x "$BUILD_ROOT/node-universal/node"

arm64_output="$(arch -arm64 "$BUILD_ROOT/node-universal/node" -p process.arch)"
x64_output="$(arch -x86_64 "$BUILD_ROOT/node-universal/node" -p process.arch)"
[[ "$arm64_output" == "arm64" ]]
[[ "$x64_output" == "x64" ]]

(
  cd "$ROOT"
  npm run build:web
)
(
  cd "$MACOS_ROOT"
  swift test
  swift build -c release --arch arm64 --arch x86_64
)
SWIFT_BIN_PATH="$(
  cd "$MACOS_ROOT"
  swift build -c release --arch arm64 --arch x86_64 --show-bin-path
)"
test -x "$SWIFT_BIN_PATH/SpaceNotes"
bash "$ROOT/scripts/build-macos-fs-helper.sh" \
  "$BUILD_ROOT/space-notes-fs"

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
  "$APP_PATH/Contents/Resources/sidecar/electron"
cp "$SWIFT_BIN_PATH/SpaceNotes" \
  "$APP_PATH/Contents/MacOS/SpaceNotes"
cp "$BUILD_ROOT/node-universal/node" "$APP_PATH/Contents/Resources/node"
cp -R "$ROOT/dist/." "$APP_PATH/Contents/Resources/web/"
cp "$MACOS_ROOT/bridge/levilNotesBridge.js" \
  "$APP_PATH/Contents/Resources/levilNotesBridge.js"
cp "$ROOT/electron/api.cjs" "$ROOT/electron/git.cjs" \
  "$ROOT/electron/file-operations.cjs" \
  "$ROOT/electron/sidecar.cjs" "$ROOT/electron/sidecar-entry.cjs" \
  "$ROOT/electron/vault.cjs" \
  "$APP_PATH/Contents/Resources/sidecar/electron/"
cp "$BUILD_ROOT/space-notes-fs" \
  "$APP_PATH/Contents/Resources/space-notes-fs"
cp "$BUILD_ROOT/sidecar-runtime/package.json" \
  "$APP_PATH/Contents/Resources/sidecar/"
cp -R "$BUILD_ROOT/sidecar-runtime/node_modules" \
  "$APP_PATH/Contents/Resources/sidecar/"
cp "$BUILD_ROOT/LevilNotes.icns" \
  "$APP_PATH/Contents/Resources/LevilNotes.icns"

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
  <string>0.2.0</string>
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
printf 'APPL????' > "$APP_PATH/Contents/PkgInfo"

plutil -lint "$APP_PATH/Contents/Info.plist"
codesign --force --deep --sign - "$APP_PATH"
"$ROOT/scripts/verify-macos-bundle.sh" \
  "$APP_PATH" "$BUILD_ROOT/macho-architectures.txt"

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
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true
}
trap cleanup EXIT
retry_hdiutil attach 5 2 -quiet -readonly -nobrowse \
  -mountpoint "$mount_point" "$DMG_PATH"
test -d "$mount_point/Levil Notes.app"
test -L "$mount_point/Applications"

(
  cd "$BUILD_ROOT"
  shasum -a 256 "$(basename "$DMG_PATH")"
) | tee "$BUILD_ROOT/Levil Notes 0.2.0.dmg.sha256"
echo "构建完成：$DMG_PATH"
