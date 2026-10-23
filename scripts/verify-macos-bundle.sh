#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="${1:-$ROOT/build/macos/Levil Notes.app}"
MANIFEST_PATH="${2:-$ROOT/build/macos/macho-architectures.txt}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "应用不存在：$APP_PATH" >&2
  exit 1
fi

: > "$MANIFEST_PATH"
failures=0

while IFS= read -r -d '' candidate; do
  description="$(file -b "$candidate")"
  if [[ "$description" != *"Mach-O"* ]]; then
    continue
  fi
  architectures="$(lipo -archs "$candidate" 2>/dev/null || true)"
  relative="${candidate#"$APP_PATH"/}"
  printf '%s\t%s\n' "$architectures" "$relative" >> "$MANIFEST_PATH"
  if [[ "$architectures" != *"arm64"* || "$architectures" != *"x86_64"* ]]; then
    echo "缺少通用架构：$relative ($architectures)" >&2
    failures=$((failures + 1))
  fi
done < <(find "$APP_PATH" -type f -print0)

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi
if [[ ! -s "$MANIFEST_PATH" ]]; then
  echo "没有找到 Mach-O 文件。" >&2
  exit 1
fi

echo "Mach-O 架构检查通过：$MANIFEST_PATH"
