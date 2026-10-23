#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_BUNDLE="${1:-$ROOT/build/macos/Levil Notes.app}"
REPORT_PATH="${2:-$ROOT/docs/evidence/v0.2.0/e2e-wkwebview.json}"
DMG_PATH="${3:-$ROOT/build/macos/Levil Notes 0.2.0.dmg}"

APP_BUNDLE="$(cd "$(dirname "$APP_BUNDLE")" && pwd)/$(basename "$APP_BUNDLE")"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/SpaceNotes"
SUPPORT_DIR="$HOME/Library/Application Support/Levil Notes"
SETTINGS_PATH="$SUPPORT_DIR/settings.json"
LOG_PATH="$SUPPORT_DIR/e2e-wkwebview.log"
BACKUP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spacenotes-evidence-backup.XXXXXX")"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spacenotes-e2e.XXXXXX")"
SETTINGS_BACKUP="$BACKUP_ROOT/settings.json"
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ -f "$SETTINGS_BACKUP" ]]; then
    cp "$SETTINGS_BACKUP" "$SETTINGS_PATH"
  else
    rm -f "$SETTINGS_PATH"
  fi
}
trap cleanup EXIT INT TERM

test -x "$APP_EXECUTABLE"
mkdir -p "$SUPPORT_DIR" "$(dirname "$REPORT_PATH")"
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

for _ in {1..180}; do
  if [[ -s "$REPORT_PATH" ]]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "application exited before writing the E2E report" >&2
    tail -n 120 "$LOG_PATH" >&2 || true
    exit 1
  fi
  sleep 1
done

if [[ ! -s "$REPORT_PATH" ]]; then
  echo "timed out waiting for the WKWebView E2E report" >&2
  tail -n 120 "$LOG_PATH" >&2 || true
  exit 1
fi

node - "$REPORT_PATH" "$DMG_PATH" "$FIXTURE_ROOT" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [reportPath, dmgPath, fixtureRoot] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
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
if (!["CERTIFIED", "PASS"].includes(report.status)) {
  failures.push(`unexpected status ${report.status}`);
}
if (!["CERTIFIED", "PASS"].includes(report.conclusion)) {
  failures.push(`unexpected conclusion ${report.conclusion}`);
}
if (!Number.isInteger(report.total) || report.total < 58) {
  failures.push(`expected at least 58 flows, got ${report.total}`);
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
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `WKWebView E2E certified: ${report.passed}/${report.total}\n`,
);
NODE

kill -TERM "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
APP_PID=""
