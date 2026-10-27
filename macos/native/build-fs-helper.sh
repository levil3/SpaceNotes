#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${1:-$ROOT/build/macos/space-notes-fs}"
ARCH="${2:-universal}"
case "$ARCH" in
  arm64)
    ARCH_FLAGS=(-arch arm64)
    EXPECTED_ARCHS="arm64"
    ;;
  x64|x86_64)
    ARCH_FLAGS=(-arch x86_64)
    EXPECTED_ARCHS="x86_64"
    ;;
  universal)
    ARCH_FLAGS=(-arch arm64 -arch x86_64)
    EXPECTED_ARCHS="x86_64 arm64"
    ;;
  *)
    echo "无效架构: $ARCH（可选 arm64|x64|universal）" >&2
    exit 1
    ;;
esac
SOURCE="$ROOT/macos/native/space-notes-fs.c"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$(dirname "$OUTPUT")"
xcrun --sdk macosx clang \
  -isysroot "$SDK_PATH" \
  -mmacosx-version-min=13.5 \
  "${ARCH_FLAGS[@]}" \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  "$SOURCE" \
  -o "$OUTPUT"
chmod +x "$OUTPUT"
test "$(lipo -archs "$OUTPUT")" = "$EXPECTED_ARCHS"
