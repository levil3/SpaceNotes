#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${1:-$ROOT/build/macos/space-notes-fs}"
SOURCE="$ROOT/macos/native/space-notes-fs.c"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$(dirname "$OUTPUT")"
xcrun --sdk macosx clang \
  -isysroot "$SDK_PATH" \
  -mmacosx-version-min=13.5 \
  -arch arm64 \
  -arch x86_64 \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  "$SOURCE" \
  -o "$OUTPUT"
chmod +x "$OUTPUT"
test "$(lipo -archs "$OUTPUT")" = "x86_64 arm64"
