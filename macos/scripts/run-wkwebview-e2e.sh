#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_BUNDLE="${1:-$ROOT/build/macos/Levil Notes.app}"
REPORT_PATH="${2:-$ROOT/docs/evidence/v0.2.0/e2e-wkwebview.json}"
DMG_PATH="${3:-$ROOT/build/macos/Levil Notes 0.2.0.dmg}"
EVIDENCE_DIAGNOSTICS_PATH="${4:-$(dirname "$REPORT_PATH")/diagnostics.log}"

APP_BUNDLE="$(cd "$(dirname "$APP_BUNDLE")" && pwd)/$(basename "$APP_BUNDLE")"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/SpaceNotes"
SUPPORT_DIR="$HOME/Library/Application Support/Levil Notes"
SETTINGS_PATH="$SUPPORT_DIR/settings.json"
LOG_PATH="$SUPPORT_DIR/e2e-wkwebview.log"
DIAGNOSTICS_PATH="$SUPPORT_DIR/diagnostics.log"
BACKUP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spacenotes-evidence-backup.XXXXXX")"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spacenotes-e2e.XXXXXX")"
SETTINGS_BACKUP="$BACKUP_ROOT/settings.json"
APP_PID=""
DIAGNOSTICS_START_BYTES=0
export SPACENOTES_BACKGROUND_E2E=1

redact_diagnostics() {
  "$ROOT/macos/scripts/redact-log.sh" "$@"
}

current_diagnostics() {
  if [[ ! -f "$DIAGNOSTICS_PATH" ]]; then
    return
  fi
  local current_bytes
  current_bytes="$(stat -f %z "$DIAGNOSTICS_PATH")"
  if (( current_bytes >= DIAGNOSTICS_START_BYTES )); then
    tail -c "+$((DIAGNOSTICS_START_BYTES + 1))" "$DIAGNOSTICS_PATH"
  else
    cat "$DIAGNOSTICS_PATH"
  fi
}

dump_diagnostics() {
  if [[ -f "$DIAGNOSTICS_PATH" ]]; then
    echo "last application diagnostics:" >&2
    current_diagnostics | redact_diagnostics | tail -n 160 >&2 || true
  fi
}

persist_diagnostics() {
  mkdir -p "$(dirname "$EVIDENCE_DIAGNOSTICS_PATH")"
  if [[ -f "$DIAGNOSTICS_PATH" ]]; then
    current_diagnostics | redact_diagnostics > "$EVIDENCE_DIAGNOSTICS_PATH"
  else
    : > "$EVIDENCE_DIAGNOSTICS_PATH"
  fi
}

cleanup() {
  local exit_code="${1:-0}"
  trap - EXIT INT TERM
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  persist_diagnostics || true
  if [[ -f "$SETTINGS_BACKUP" ]]; then
    cp "$SETTINGS_BACKUP" "$SETTINGS_PATH" || true
  else
    rm -f "$SETTINGS_PATH" || true
  fi
  exit "$exit_code"
}
trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

mkdir -p "$SUPPORT_DIR" "$(dirname "$REPORT_PATH")"
if [[ -f "$DIAGNOSTICS_PATH" ]]; then
  DIAGNOSTICS_START_BYTES="$(stat -f %z "$DIAGNOSTICS_PATH")"
fi
test -x "$APP_EXECUTABLE"
if [[ -f "$SETTINGS_PATH" ]]; then
  cp "$SETTINGS_PATH" "$SETTINGS_BACKUP"
fi

mkdir -p "$FIXTURE_ROOT/notes/images"
printf '# Welcome\n\nThis is the macOS end-to-end vault.\n\n![1.00](images/pixel.png)\n' \
  > "$FIXTURE_ROOT/notes/welcome.md"
printf '# Second note\n\nSearchable phrase: blue lantern.\n\n#e2e\n' \
  > "$FIXTURE_ROOT/notes/second.md"
printf '# SpaceNotes fixture\n' > "$FIXTURE_ROOT/README.md"
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="evil"</script></svg>\n' \
  > "$FIXTURE_ROOT/evil.svg"
cp "$ROOT/resources/icon.png" "$FIXTURE_ROOT/notes/images/pixel.png"

git -C "$FIXTURE_ROOT" init -b main >/dev/null
git -C "$FIXTURE_ROOT" config user.name "SpaceNotes Certification"
git -C "$FIXTURE_ROOT" config user.email "spacenotes@example.test"
git -C "$FIXTURE_ROOT" add .
git -C "$FIXTURE_ROOT" commit -m "test: seed macOS E2E vault" >/dev/null

node -e '
  const fs = require("node:fs");
  const settings = {
    appearanceRevision: 4,
    themeMode: "light",
    accent: "#4b708b",
    background: "#ffffff",
    textColor: "#333333",
    editorFontSize: 15,
    editorLineHeight: 1.8,
    contentWidth: 1200,
    sidebarWidth: 320,
    sidebarCollapsed: false,
    showHiddenFiles: false,
    recentVault: process.argv[1],
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(settings, null, 2));
' "$FIXTURE_ROOT" "$SETTINGS_PATH"

rm -f "$REPORT_PATH"
SPACENOTES_DMG_PATH="$DMG_PATH" \
SPACENOTES_E2E_FIXTURE="$FIXTURE_ROOT" \
  "$APP_EXECUTABLE" --e2e-report "$REPORT_PATH" \
  > "$LOG_PATH" 2>&1 &
APP_PID=$!

for _ in {1..240}; do
  if [[ -s "$REPORT_PATH" ]]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "application exited before writing the E2E report" >&2
    tail -n 120 "$LOG_PATH" >&2 || true
    dump_diagnostics
    exit 1
  fi
  sleep 1
done

if [[ ! -s "$REPORT_PATH" ]]; then
  echo "timed out waiting for the WKWebView E2E report" >&2
  tail -n 120 "$LOG_PATH" >&2 || true
  dump_diagnostics
  exit 1
fi

validate_report() {
node - "$REPORT_PATH" "$DMG_PATH" "$FIXTURE_ROOT" \
  "$EVIDENCE_DIAGNOSTICS_PATH" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [reportPath, dmgPath, fixtureRoot, diagnosticsPath] = process.argv.slice(2);
const redact = (value) =>
  String(value)
    .replace(/(token=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]");
const redactObject = (value) => {
  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactObject(entry)]),
    );
  }
  return value;
};
let report;
try {
  report = redactObject(JSON.parse(fs.readFileSync(reportPath, "utf8")));
} catch (error) {
  try {
    const raw = fs.readFileSync(reportPath, "utf8");
    fs.writeFileSync(reportPath, redact(raw));
  } catch {
    // The original report error is more useful than a secondary rewrite error.
  }
  process.stderr.write(`invalid E2E report: ${redact(error.message)}\n`);
  process.exit(1);
}
report.artifact = fs.existsSync(dmgPath) ? path.basename(dmgPath) : "";
report.sha256 = fs.existsSync(dmgPath)
  ? crypto.createHash("sha256").update(fs.readFileSync(dmgPath)).digest("hex")
  : "";
report.fixtureRoot = fixtureRoot;
report.host = {
  macOS: os.release(),
  architecture: process.arch,
  node: process.version,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const failures = [];
const diagnostics = diagnosticsPath && fs.existsSync(diagnosticsPath)
  ? redact(fs.readFileSync(diagnosticsPath, "utf8"))
  : "";
if (!["CERTIFIED", "PASS"].includes(report.status)) {
  failures.push(`unexpected status ${report.status}`);
}
if (report.executionMode !== "background-offscreen") {
  failures.push(
    `expected background-offscreen execution, got ${report.executionMode}`,
  );
}
if (!["CERTIFIED", "PASS"].includes(report.conclusion)) {
  failures.push(`unexpected conclusion ${report.conclusion}`);
}
if (!Number.isInteger(report.total) || report.total !== 60) {
  failures.push(`expected exactly 60 flows, got ${report.total}`);
}
if (report.passed !== report.total || report.failed !== 0) {
  failures.push(
    `flow counts are inconsistent: total=${report.total} passed=${report.passed} failed=${report.failed}`,
  );
}
if (!Array.isArray(report.results) || report.results.length !== report.total) {
  failures.push("result list does not match the certified total");
}
if (!Array.isArray(report.failures) || report.failures.length !== 0) {
  failures.push("failure list is not empty");
}
const nativeControls =
  "native-window-controls=close=true,minimize=true,full-screen=true";
if (!diagnostics.includes(nativeControls)) {
  failures.push("native macOS window controls were not created");
}
if (!diagnostics.includes("background-window-offscreen=true")) {
  failures.push("background E2E window was not moved offscreen");
}
if (!diagnostics.includes("background-window-screen-intersections=0")) {
  failures.push("background E2E window still intersects a display");
}
if (!diagnostics.includes("background-same-origin-navigation-canceled=true")) {
  failures.push("same-origin asset navigation was not canceled");
}
if (diagnostics.includes("background-external-navigation-suppressed=")) {
  failures.push("background E2E attempted to open an external application");
}
const requiredFlowNames = [
  "shell-layout",
  "file-filter-welcome",
  "search-query-results",
  "git-history-tab",
  "vault-image",
  "transfer-create-write-read",
  "transfer-native-trash",
  "transfer-save-event",
  "transfer-git-commit"
];
if (Array.isArray(report.results)) {
  const actualNames = new Set(report.results.map((result) => result.name));
  for (const name of requiredFlowNames) {
    if (!actualNames.has(name)) {
      failures.push(`required flow is missing: ${name}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  if (Array.isArray(report.failures) && report.failures.length) {
    process.stderr.write(`${JSON.stringify(report.failures, null, 2)}\n`);
  }
  if (diagnostics) {
    process.stderr.write("last application diagnostics:\n");
    process.stderr.write(`${diagnostics.split("\n").slice(-160).join("\n")}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `WKWebView E2E certified: ${report.passed}/${report.total}\n`,
);
NODE
}

persist_diagnostics
if ! validate_report; then
  tail -n 120 "$LOG_PATH" >&2 || true
  dump_diagnostics
  exit 1
fi

kill -TERM "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
APP_PID=""
