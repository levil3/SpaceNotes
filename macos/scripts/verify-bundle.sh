#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_PATH="${1:-$ROOT/build/macos/Levil Notes.app}"
MANIFEST_PATH="${2:-$ROOT/build/macos/macho-architectures.txt}"
EXPECTED_ARCH="${3:-universal}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "应用不存在：$APP_PATH" >&2
  exit 1
fi

info_plist="$APP_PATH/Contents/Info.plist"
if [[ ! -f "$info_plist" ]]; then
  echo "应用缺少 Info.plist：$info_plist" >&2
  exit 1
fi
local_networking="$(
  /usr/libexec/PlistBuddy \
    -c "Print :NSAppTransportSecurity:NSAllowsLocalNetworking" \
    "$info_plist" 2>/dev/null || true
)"
if [[ "$local_networking" != "true" ]]; then
  echo "Info.plist 未允许本地网络访问。" >&2
  exit 1
fi

: > "$MANIFEST_PATH"
failures=0

architectures_ok() {
  local architectures="$1"
  case "$EXPECTED_ARCH" in
    arm64)
      [[ "$architectures" == *arm64* && "$architectures" != *x86_64* ]] ;;
    x64)
      [[ "$architectures" == *x86_64* && "$architectures" != *arm64* ]] ;;
    universal)
      [[ "$architectures" == *arm64* && "$architectures" == *x86_64* ]] ;;
    *)
      echo "无效架构: $EXPECTED_ARCH（可选 arm64|x64|universal）" >&2
      return 2
      ;;
  esac
}

while IFS= read -r -d '' candidate; do
  description="$(file -b "$candidate")"
  if [[ "$description" != *"Mach-O"* ]]; then
    continue
  fi
  architectures="$(lipo -archs "$candidate" 2>/dev/null || true)"
  relative="${candidate#"$APP_PATH"/}"
  printf '%s\t%s\n' "$architectures" "$relative" >> "$MANIFEST_PATH"
  if ! architectures_ok "$architectures"; then
    echo "架构不符合预期（期望 $EXPECTED_ARCH）：$relative ($architectures)" >&2
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
