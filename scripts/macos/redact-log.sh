#!/bin/bash
set -euo pipefail

if [[ $# -gt 0 ]]; then
  exec sed -E \
    -e 's/([Tt][Oo][Kk][Ee][Nn]=)[^&[:space:]]+/\1[redacted]/g' \
    -e 's/([Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    "$1"
fi

exec sed -E \
  -e 's/([Tt][Oo][Kk][Ee][Nn]=)[^&[:space:]]+/\1[redacted]/g' \
  -e 's/([Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+)[^[:space:]]+/\1[redacted]/g'
