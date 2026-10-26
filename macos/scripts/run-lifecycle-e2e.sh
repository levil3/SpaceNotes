#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$ROOT/package.json")"
APP_BUNDLE="${SPACENOTES_APP_BUNDLE:-/Applications/Levil Notes.app}"
REPORT_PATH="${1:-$ROOT/docs/evidence/v${VERSION}/lifecycle.json}"
DMG_PATH="${SPACENOTES_DMG_PATH:-$ROOT/build/macos/Levil Notes ${VERSION}.dmg}"
DIAGNOSTICS="$HOME/Library/Application Support/Levil Notes/diagnostics.log"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/SpaceNotes"
SIDECAR_PATTERN="$APP_BUNDLE/Contents/Resources/node $APP_BUNDLE/Contents/Resources/sidecar/macos/sidecar/sidecar-entry.cjs"

app_pid=""
sidecar_pid=""

print_failure_context() {
  local status="$1"
  echo "lifecycle regression failed with status $status" >&2
  echo "app_pid=${app_pid:-none} sidecar_pid=${sidecar_pid:-none}" >&2
  if [[ -n "$app_pid" ]]; then
    ps -o pid=,ppid=,state=,command= -p "$app_pid" >&2 || true
  fi
  if [[ -n "$sidecar_pid" ]]; then
    ps -o pid=,ppid=,state=,command= -p "$sidecar_pid" >&2 || true
  fi
  if [[ -f "$DIAGNOSTICS" ]]; then
    echo "last application diagnostics:" >&2
    tail -n 120 "$DIAGNOSTICS" \
      | "$ROOT/macos/scripts/redact-log.sh" >&2 \
      || true
  fi
}

cleanup() {
  local exit_code="${1:-$?}"
  trap - EXIT INT TERM
  if [[ "$exit_code" -ne 0 ]]; then
    print_failure_context "$exit_code"
  fi
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$sidecar_pid" ]] && kill -0 "$sidecar_pid" 2>/dev/null; then
    kill -TERM "$sidecar_pid" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

wait_for_new_pid() {
  local pattern="$1"
  local pid=""
  for _ in {1..80}; do
    pid="$(pgrep -n -f "$pattern" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_child_pid() {
  local parent_pid="$1"
  local pattern="$2"
  local excluded="${3:-}"
  local pid=""
  for _ in {1..80}; do
    pid="$(pgrep -P "$parent_pid" -n -f "$pattern" 2>/dev/null || true)"
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

wait_for_window_count() {
  local expected="$1"
  local count=""
  for _ in {1..80}; do
    count="$(osascript <<APPLESCRIPT 2>/dev/null || true
tell application "System Events"
  set appProcess to first application process whose unix id is $app_pid
  return count of windows of appProcess
end tell
APPLESCRIPT
)"
    if [[ "$count" == "$expected" ]]; then
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
  if pgrep -f "^$APP_EXECUTABLE$" >/dev/null 2>&1; then
    echo "the application must not already be running" >&2
    return 1
  fi
  open -a "$APP_BUNDLE"
  app_pid="$(wait_for_new_pid "^$APP_EXECUTABLE$")"
  sidecar_pid="$(wait_for_child_pid "$app_pid" "$SIDECAR_PATTERN")"
  wait_for_log_marker "window=shown" "$start_line"
  wait_for_log_marker '"hasBridge":true' "$start_line"
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
menus="$(osascript <<APPLESCRIPT
tell application "System Events"
  set appProcess to first application process whose unix id is $app_pid
  return name of every menu bar item of menu bar 1 of appProcess
end tell
APPLESCRIPT
)"
native_window_control_subroles="$(osascript <<APPLESCRIPT
tell application "System Events"
  set appProcess to first application process whose unix id is $app_pid
  return subrole of every button of window 1 of appProcess
end tell
APPLESCRIPT
)"
for expected_subrole in AXCloseButton AXMinimizeButton AXFullScreenButton; do
  if [[ ", $native_window_control_subroles, " != *", $expected_subrole, "* ]]; then
    echo "missing native window control: $expected_subrole" >&2
    exit 1
  fi
done

diagnostics_before_native_close="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
osascript -e 'tell application "Levil Notes" to activate'
sleep 0.5
osascript <<APPLESCRIPT
tell application "System Events"
  set appProcess to first application process whose unix id is $app_pid
  set frontmost of appProcess to true
  set closeButton to first button of window 1 of appProcess \
    whose subrole is "AXCloseButton"
  perform action "AXPress" of closeButton
end tell
APPLESCRIPT
wait_for_log_marker "window-closed-app-persisted" "$diagnostics_before_native_close"
wait_for_log_marker "window-closed-webview-retained=true" \
  "$diagnostics_before_native_close"
wait_for_window_count 0
kill -0 "$app_pid"
kill -0 "$sidecar_pid"

diagnostics_before_native_reopen="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
open -a "$APP_BUNDLE"
wait_for_log_marker "window-reopened-from-dock-request" \
  "$diagnostics_before_native_reopen"
wait_for_log_marker "window-reopened-existing-instance" \
  "$diagnostics_before_native_reopen"
wait_for_window_count 1

diagnostics_before_menu_close="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
osascript <<APPLESCRIPT
tell application "System Events"
  set appProcess to first application process whose unix id is $app_pid
  click menu item "关闭窗口" of menu 1 of menu bar item "窗口" of menu bar 1 of appProcess
end tell
APPLESCRIPT
wait_for_log_marker "window-closed-app-persisted" "$diagnostics_before_menu_close"
wait_for_log_marker "window-closed-webview-retained=true" \
  "$diagnostics_before_menu_close"
wait_for_window_count 0
kill -0 "$app_pid"
kill -0 "$sidecar_pid"

diagnostics_before_menu_reopen="$(wc -l < "$DIAGNOSTICS" | tr -d ' ')"
open -a "$APP_BUNDLE"
wait_for_log_marker "window-reopened-from-dock-request" \
  "$diagnostics_before_menu_reopen"
wait_for_log_marker "window-reopened-existing-instance" \
  "$diagnostics_before_menu_reopen"
wait_for_window_count 1

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
replacement_sidecar_pid="$(
  wait_for_child_pid \
    "$crash_app_pid" \
    "$SIDECAR_PATTERN" \
    "$original_sidecar_pid"
)"
sidecar_pid="$replacement_sidecar_pid"
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
if pgrep -P "$crash_app_pid" -f "$SIDECAR_PATTERN" >/dev/null 2>&1; then
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
export WINDOW_CLOSED_PROCESS_ALIVE=1
export WINDOW_REOPEN_OBSERVED=1
export WINDOW_WEBVIEW_RETAINED=1
export WINDOW_INSTANCE_REUSED=1
export NATIVE_WINDOW_CONTROL_SUBROLES="$native_window_control_subroles"
export CRASH_APP_PID="$crash_app_pid"
export ORIGINAL_SIDECAR_PID="$original_sidecar_pid"
export REPLACEMENT_SIDECAR_PID="$replacement_sidecar_pid"
export ORIGINAL_TOKEN_FINGERPRINT="$original_token_fingerprint"
export REPLACEMENT_TOKEN_FINGERPRINT="$replacement_token_fingerprint"
export DIAGNOSTICS_BEFORE_CRASH="$diagnostics_before"
export WINDOW_LIFECYCLE_STATUS="PASS"
export MENU_ACCESSIBILITY_STATUS="PASS"
export SINGLE_CRASH_STATUS="PASS"
export REPEATED_CRASH_STATUS="PASS"
export NORMAL_QUIT_STATUS="PASS"
export COMPUTER_USE_VISUAL_STATUS="${SPACENOTES_COMPUTER_USE_VISUAL_STATUS:-INCONCLUSIVE}"
export COMPUTER_USE_VISUAL_REASON="${SPACENOTES_COMPUTER_USE_VISUAL_REASON:-The unified computer-use entry point was unavailable. Native menus and window state were validated through System Events; this report does not claim a visual screenshot pass.}"

node "$ROOT/macos/scripts/lifecycle-report.cjs"
