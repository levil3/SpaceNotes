#!/bin/bash
set -euo pipefail

# 已由 build-macos.sh 取代。此壳仅为兼容旧引用保留，行为与旧脚本一致
#（无参数时构建 universal DMG）。确认仓库内已无引用后可删除本文件。
echo "build-universal.sh 已废弃，请改用: bash macos/scripts/build-macos.sh [--arch arm64|x64|universal]" >&2
exec "$(cd "$(dirname "$0")" && pwd)/build-macos.sh" --arch universal "$@"
