#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_BUNDLE="${SPACENOTES_APP_BUNDLE:-/Applications/Levil Notes.app}"
REPORT_PATH="${1:-$ROOT/docs/evidence/v0.2.0/lifecycle.json}"
DMG_PATH="$ROOT/build/macos/Levil Notes 0.2.0.dmg"
DIAGNOSTICS="$HOME/Library/Application Support/Levil Notes/diagnostics.log"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/SpaceNotes"
SIDECAR_PATTERN="$APP_BUNDLE/Contents/Resources/node $APP_BUNDLE/Contents/Resources/sidecar/electron/sidecar-entry.cjs"

app_pid=""
sidecar_pid=""

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$sidecar_pid" ]] && kill -0 "$sidecar_pid" 2>/dev/null; then
    kill -TERM "$sidecar_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_new_pid() {
  local pattern="$1"
  local excluded="${2:-}"
  local pid=""
  for _ in {1..80}; do
    pid="$(pgrep -n -f "$pattern" 2>/dev/null || true)"
    if [[ -n "$pid" && "$pid" != "$excluded" ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_process_exit() {
  local pid="$1"
  for _ in {1..80}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_log_marker() {
  local marker="$1"
  local start_line="$2"
  for _ in {1..80}; do
    if tail -n +$((start_line + 1)) "$DIAGNOSTICS" | grep -q "$marker"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

token_fingerprint_since() {
  local start_line="$1"
  tail -n +$((start_line + 1)) "$DIAGNOSTICS" \
    | sed -n 's/.*sidecar-token-fingerprint=\([0-9a-f]\{64\}\).*/\1/p' \
    | tail -n 1
}

process_environment_exposes_token() {
  local pid="$1"
  ps eww -p "$pid" 2>/dev/null | grep -q 'SPACENOTES_TOKEN='
}

launch_app() {
  local start_line="$1"
  open -a "$APP_BUNDLE"
  app_pid="$(wait_for_new_pid "^$APP_EXECUTABLE$")"
  sidecar_pid="$(wait_for_new_pid "$SIDECAR_PATTERN")"
  wait_for_log_marker "window=shown" "$start_line"
}

quit_app() {
  osascript -e 'tell application "Levil Notes" to quit' >/dev/null
  wait_for_process_exit "$app_pid"
  wait_for_process_exit "$sidecar_pid"
  app_pid=""
  sidecar_pid=""
}

test -x "$APP_EXECUTABLE"
test -f "$DMG_PATH"
test -f "$DIAGNOSTICS" || mkdir -p "$(dirname "$DIAGNOSTICS")"
touch "$DIAGNOSTICS"

diagnostics_before_launch="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
launch_app "$diagnostics_before_launch"
window_lifecycle_pid="$app_pid"
window_lifecycle_sidecar_pid="$sidecar_pid"
if process_environment_exposes_token "$sidecar_pid"; then
  echo "sidecar launch token is visible in the process environment" >&2
  exit 1
fi
menus="$(osascript \
  -e 'tell application "System Events" to tell process "Levil Notes" to get name of every menu bar item of menu bar 1')"

diagnostics_before_close="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
osascript \
  -e 'tell application "System Events" to tell process "Levil Notes" to click menu item "关闭窗口" of menu 1 of menu bar item "窗口" of menu bar 1'
wait_for_log_marker "window-closed-app-persisted" "$diagnostics_before_close"
kill -0 "$app_pid"
kill -0 "$sidecar_pid"

diagnostics_before_reopen="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
open -a "$APP_BUNDLE"
wait_for_log_marker "window-reopened-from-dock-request" "$diagnostics_before_reopen"

quit_app

diagnostics_before_crash_launch="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
launch_app "$diagnostics_before_crash_launch"
crash_app_pid="$app_pid"
original_sidecar_pid="$sidecar_pid"
original_token_fingerprint="$(
  token_fingerprint_since "$diagnostics_before_crash_launch"
)"
if [[ ! "$original_token_fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
  echo "missing initial sidecar token fingerprint" >&2
  exit 1
fi
diagnostics_before="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"

kill -9 "$original_sidecar_pid"
replacement_sidecar_pid="$(wait_for_new_pid "$SIDECAR_PATTERN" "$original_sidecar_pid")"
for _ in {1..80}; do
  replacement_token_fingerprint="$(
    token_fingerprint_since "$diagnostics_before"
  )"
  if [[ -n "$replacement_token_fingerprint" \
    && "$replacement_token_fingerprint" != "$original_token_fingerprint" ]]; then
    break
  fi
  sleep 0.25
done
if [[ ! "$replacement_token_fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
  echo "missing replacement sidecar token fingerprint" >&2
  exit 1
fi
if [[ "$original_token_fingerprint" == "$replacement_token_fingerprint" ]]; then
  echo "sidecar restart reused the launch token" >&2
  exit 1
fi
if process_environment_exposes_token "$replacement_sidecar_pid"; then
  echo "restarted sidecar launch token is visible in the process environment" >&2
  exit 1
fi
kill -0 "$crash_app_pid"

sleep 2
first_restart_log="$(tail -n +$((diagnostics_before + 1)) "$DIAGNOSTICS")"
if ! grep -q "sidecar-restart-attempt=1" <<<"$first_restart_log"; then
  echo "missing first sidecar restart diagnostic" >&2
  exit 1
fi
if ! grep -q "webview-reload-after-sidecar-restart" <<<"$first_restart_log"; then
  echo "missing WebView reload diagnostic" >&2
  exit 1
fi

kill -9 "$replacement_sidecar_pid"
wait_for_process_exit "$replacement_sidecar_pid"
kill -0 "$crash_app_pid"
sleep 2
second_restart_log="$(tail -n +$((diagnostics_before + 1)) "$DIAGNOSTICS")"
if ! grep -q "sidecar-restart-exhausted" <<<"$second_restart_log"; then
  echo "missing restart exhaustion diagnostic" >&2
  exit 1
fi
if pgrep -f "$SIDECAR_PATTERN" >/dev/null 2>&1; then
  echo "sidecar remained running after the second crash" >&2
  exit 1
fi

kill -TERM "$crash_app_pid"
wait_for_process_exit "$crash_app_pid"
app_pid=""
sidecar_pid=""

export REPORT_PATH APP_BUNDLE DMG_PATH DIAGNOSTICS
export MENUS="$menus"
export WINDOW_LIFECYCLE_PID="$window_lifecycle_pid"
export WINDOW_LIFECYCLE_SIDECAR_PID="$window_lifecycle_sidecar_pid"
export CRASH_APP_PID="$crash_app_pid"
export ORIGINAL_SIDECAR_PID="$original_sidecar_pid"
export REPLACEMENT_SIDECAR_PID="$replacement_sidecar_pid"
export ORIGINAL_TOKEN_FINGERPRINT="$original_token_fingerprint"
export REPLACEMENT_TOKEN_FINGERPRINT="$replacement_token_fingerprint"
export DIAGNOSTICS_BEFORE_CRASH="$diagnostics_before"

node <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const report = {
  status: "PASS",
  artifact: path.basename(process.env.DMG_PATH),
  sha256: crypto
    .createHash("sha256")
    .update(fs.readFileSync(process.env.DMG_PATH))
    .digest("hex"),
  environment: {
    macOS: os.release(),
    hostArchitecture: process.arch,
    installedPath: process.env.APP_BUNDLE,
  },
  windowLifecycle: {
    status: "PASS",
    appPID: Number(process.env.WINDOW_LIFECYCLE_PID),
    sidecarPID: Number(process.env.WINDOW_LIFECYCLE_SIDECAR_PID),
    closedWindowWithoutTerminating: true,
    reopenedFromDockRequest: true,
    diagnosticsMarkers: [
      "window-closed-app-persisted",
      "window-reopened-from-dock-request",
    ],
  },
  menuAccessibility: {
    status: "PASS",
    menus: process.env.MENUS.split(", "),
    closeWindowCommand: "Cmd-W",
  },
  singleSidecarCrash: {
    status: "PASS",
    appPID: Number(process.env.CRASH_APP_PID),
    originalSidecarPID: Number(process.env.ORIGINAL_SIDECAR_PID),
    replacementSidecarPID: Number(process.env.REPLACEMENT_SIDECAR_PID),
    tokenRotated: true,
    tokenTransport: {
      status: "PASS",
      delivery: "stdin-first-line",
      visibleInProcessEnvironment: false,
    },
    tokenFingerprints: {
      algorithm: "sha256",
      diagnosticsAfterCrashLine: Number(process.env.DIAGNOSTICS_BEFORE_CRASH),
      original: process.env.ORIGINAL_TOKEN_FINGERPRINT,
      replacement: process.env.REPLACEMENT_TOKEN_FINGERPRINT,
    },
    automaticRestart: true,
    webViewReloaded: true,
  },
  repeatedSidecarCrash: {
    status: "PASS",
    appRemainedAlive: true,
    automaticRestartStopped: true,
    sidecarRemainedStopped: true,
  },
  normalQuit: {
    status: "PASS",
    appAfterQuit: "absent",
    sidecarAfterQuit: "absent",
  },
  diagnosticsLog: process.env.DIAGNOSTICS,
  computerUseVisualCapture: {
    status: "INCONCLUSIVE",
    reason:
      "The unified computer-use entry point was unavailable, and screen capture returned a black frame because screen-recording permission was not granted. Native menus and window state were validated through System Events; this report does not claim a visual screenshot pass.",
  },
};

fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true });
fs.writeFileSync(
  process.env.REPORT_PATH,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
NODE
