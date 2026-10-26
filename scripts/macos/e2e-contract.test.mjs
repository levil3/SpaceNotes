import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  loadE2EContract,
  requiredFlows,
  verifyE2EContract,
} = require("./check-e2e-script.cjs");
const {
  buildLifecycleReport,
  lifecycleResultIsAcceptable,
} = require("./lifecycle-report.cjs");
const directory = path.dirname(fileURLToPath(import.meta.url));
const describeMac = process.platform === "darwin" ? describe : describe.skip;

function loadShellFunction(script, name) {
  const marker = `${name}() {`;
  const start = script.indexOf(marker);
  if (start === -1) {
    throw new Error(`missing shell function ${name}`);
  }
  const bodyStart = script.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") {
      depth += 1;
    } else if (script[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated shell function ${name}`);
}

describe("macOS E2E contract", () => {
  it("keeps exactly 60 unique flows and all protected transfer flows", () => {
    const { flowNames } = loadE2EContract();
    expect(flowNames).toHaveLength(60);
    expect(new Set(flowNames).size).toBe(60);
    for (const name of requiredFlows) {
      expect(flowNames).toContain(name);
    }
    expect(() => verifyE2EContract()).not.toThrow();
  });

  it("contains a bounded runner with progress reporting and abort gating", () => {
    const { script } = loadE2EContract();
    expect(script).toContain("step timed out after 20000ms");
    expect(script).toContain('name: "e2eProgress"');
    expect(script).toContain("let aborted = false");
    expect(script).toContain("if (aborted)");
    expect(script).toContain("waiting:app-shell");
    expect(script).toContain("app shell did not become ready within 30000ms");
    expect(script).toContain("requiredFlows: 60");
  });

  it("keeps local WKWebView E2E hidden from the active desktop", () => {
    const root = path.resolve(directory, "../..");
    const runner = fs.readFileSync(
      path.join(root, "scripts/macos/run-wkwebview-e2e.sh"),
      "utf8",
    );
    const delegate = fs.readFileSync(
      path.join(root, "macos/Sources/SpaceNotesMac/AppDelegate.swift"),
      "utf8",
    );
    const main = fs.readFileSync(
      path.join(root, "macos/Sources/SpaceNotesMac/main.swift"),
      "utf8",
    );

    expect(runner).toContain("export SPACENOTES_BACKGROUND_E2E=1");
    expect(runner).toContain(
      "native-window-controls=close=true,minimize=true,full-screen=true",
    );
    expect(runner).toContain("background-window-offscreen=true");
    expect(runner).toContain("background-window-screen-intersections=0");
    expect(runner).toContain(
      "background-same-origin-navigation-canceled=true",
    );
    expect(runner).toContain(
      "background-external-navigation-suppressed=",
    );
    expect(delegate).toContain("window.alphaValue = 0");
    expect(delegate).toContain("window.ignoresMouseEvents = true");
    expect(delegate).toContain("override func constrainFrameRect(");
    expect(delegate).toContain("screen.frame.intersects(window.frame)");
    expect(delegate).toContain("background-window-offscreen=");
    expect(delegate).toContain(
      "background-same-origin-navigation-canceled=true",
    );
    expect(delegate).toContain("if !backgroundE2E");
    expect(delegate).toContain("native-window-controls=");
    expect(main).toContain(
      "application.setActivationPolicy(backgroundE2E ? .accessory : .regular)",
    );
  });

  it("keeps lifecycle certification inconclusive without visual evidence", () => {
    const report = buildLifecycleReport(
      {
        WINDOW_LIFECYCLE_STATUS: "PASS",
        MENU_ACCESSIBILITY_STATUS: "PASS",
        SINGLE_CRASH_STATUS: "PASS",
        REPEATED_CRASH_STATUS: "PASS",
        NORMAL_QUIT_STATUS: "PASS",
        COMPUTER_USE_VISUAL_STATUS: "INCONCLUSIVE",
        COMPUTER_USE_VISUAL_REASON: "Computer Use unavailable.",
        DMG_PATH: "/tmp/Levil Notes 0.2.0.dmg",
        APP_BUNDLE: "/Applications/Levil Notes.app",
        DIAGNOSTICS: "/tmp/diagnostics.log",
        MENUS: "Levil Notes, File, Window",
        WINDOW_LIFECYCLE_PID: "1",
        WINDOW_LIFECYCLE_SIDECAR_PID: "2",
        WINDOW_CLOSED_PROCESS_ALIVE: "1",
        WINDOW_REOPEN_OBSERVED: "1",
        WINDOW_WEBVIEW_RETAINED: "1",
        WINDOW_INSTANCE_REUSED: "1",
        NATIVE_WINDOW_CONTROL_SUBROLES:
          "AXCloseButton, AXFullScreenButton, AXMinimizeButton",
        CRASH_APP_PID: "3",
        ORIGINAL_SIDECAR_PID: "4",
        REPLACEMENT_SIDECAR_PID: "5",
        DIAGNOSTICS_BEFORE_CRASH: "10",
        ORIGINAL_TOKEN_FINGERPRINT: "a".repeat(64),
        REPLACEMENT_TOKEN_FINGERPRINT: "b".repeat(64),
      },
      { sha256: "c".repeat(64) },
    );

    expect(report.functionalStatus).toBe("PASS");
    expect(report.status).toBe("INCONCLUSIVE");
    expect(report.menuAccessibility.closeWindowCommand).toBe(
      "native-close-button + Window menu",
    );
    expect(report.windowLifecycle.webViewRetainedAcrossClose).toBe(true);
    expect(report.windowLifecycle.reusedExistingWindowInstance).toBe(true);
    expect(report.nativeWindowControls.subroles).toEqual([
      "AXCloseButton",
      "AXFullScreenButton",
      "AXMinimizeButton",
    ]);
    expect(lifecycleResultIsAcceptable(report, "0")).toBe(false);
    expect(lifecycleResultIsAcceptable(report, "1")).toBe(true);
  });

  it("fails closed when a functional lifecycle check is not certified", () => {
    const report = buildLifecycleReport(
      {
        WINDOW_LIFECYCLE_STATUS: "PASS",
        MENU_ACCESSIBILITY_STATUS: "PASS",
        SINGLE_CRASH_STATUS: "NOT CERTIFIED",
        REPEATED_CRASH_STATUS: "PASS",
        NORMAL_QUIT_STATUS: "PASS",
        COMPUTER_USE_VISUAL_STATUS: "PASS",
        COMPUTER_USE_VISUAL_REASON: "Captured.",
        DMG_PATH: "/tmp/Levil Notes 0.2.0.dmg",
        APP_BUNDLE: "/Applications/Levil Notes.app",
        DIAGNOSTICS: "/tmp/diagnostics.log",
        MENUS: "Levil Notes, File, Window",
        WINDOW_LIFECYCLE_PID: "1",
        WINDOW_LIFECYCLE_SIDECAR_PID: "2",
        WINDOW_CLOSED_PROCESS_ALIVE: "1",
        WINDOW_REOPEN_OBSERVED: "1",
        WINDOW_WEBVIEW_RETAINED: "1",
        WINDOW_INSTANCE_REUSED: "1",
        NATIVE_WINDOW_CONTROL_SUBROLES:
          "AXCloseButton, AXFullScreenButton, AXMinimizeButton",
        CRASH_APP_PID: "3",
        ORIGINAL_SIDECAR_PID: "4",
        REPLACEMENT_SIDECAR_PID: "5",
        DIAGNOSTICS_BEFORE_CRASH: "10",
        ORIGINAL_TOKEN_FINGERPRINT: "a".repeat(64),
        REPLACEMENT_TOKEN_FINGERPRINT: "b".repeat(64),
      },
      { sha256: "c".repeat(64) },
    );

    expect(report.status).toBe("NOT CERTIFIED");
    expect(lifecycleResultIsAcceptable(report, "1")).toBe(false);
  });

  it("keeps Intel artifact paths aligned with the uploaded tree", () => {
    const root = path.resolve(directory, "../..");
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/build-macos.yml"),
      "utf8",
    );

    expect(workflow).toContain("find \"$PWD/artifact/build/macos\"");
    expect(workflow).toContain('basename "$dmg_path"');
    expect(workflow).toContain("SPACENOTES_DMG_PATH=");
  });

  it("publishes the certified DMG when a version tag is released", () => {
    const root = path.resolve(directory, "../..");
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/build-macos.yml"),
      "utf8",
    );

    expect(workflow).toContain('      - "v*"');
    expect(workflow).toContain("softprops/action-gh-release@v2");
    expect(workflow).toContain("release-artifact/build/macos/*.dmg");
    expect(workflow).toContain("needs:\n      - universal\n      - intel-smoke");
    expect(workflow).toContain("fail_on_unmatched_files: true");
  });

  it("runs native lifecycle checks on both Apple Silicon and Intel", () => {
    const root = path.resolve(directory, "../..");
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/build-macos.yml"),
      "utf8",
    );
    const jobs = workflow.slice(workflow.indexOf("\njobs:"));
    const intelStart = jobs.indexOf("\n  intel-smoke:");
    const universalJob = jobs.slice(0, intelStart);
    const intelJob = jobs.slice(intelStart);

    expect(universalJob).toContain("scripts/macos/run-lifecycle-e2e.sh");
    expect(intelJob).toContain("scripts/macos/run-lifecycle-e2e.sh");
    expect(intelJob).toContain("lifecycle-intel.json");
  });

  it("executes the app shell wait before the first E2E flow", async () => {
    const { script } = loadE2EContract();
    const firstFlow = script.indexOf('await runStep("shell-layout"');
    expect(firstFlow).toBeGreaterThan(0);
    const startup = script.slice(0, firstFlow);
    const progressMessages = [];
    let queryCount = 0;
    const window = {
      webkit: {
        messageHandlers: {
          levilNotesHost: {
            postMessage(message) {
              progressMessages.push(message.args[0]);
            },
          },
        },
      },
    };
    const document = {
      querySelector() {
        queryCount += 1;
        return queryCount >= 3 ? { className: "app-shell" } : null;
      },
    };

    await new Function(
      "window",
      "document",
      "navigator",
      "location",
      `return (async () => {${startup}\n})();`,
    )(window, document, {}, {});

    expect(queryCount).toBe(3);
    expect(progressMessages[0]).toBe("waiting:app-shell");
    expect(progressMessages.at(-1)).toBe("ready:app-shell");
  });

  it("selects a lifecycle sidecar only from the current app process", () => {
    const root = path.resolve(directory, "../..");
    const script = fs.readFileSync(
      path.join(root, "scripts/macos/run-lifecycle-e2e.sh"),
      "utf8",
    );
    const waitFunction = loadShellFunction(script, "wait_for_child_pid");
    const harness = `${waitFunction}
pgrep() {
  if [[ "$1" == "-P" && "$2" == "4242" && "$3" == "-n" \
    && "$4" == "-f" && "$5" == "sidecar pattern" ]]; then
    printf '9001\\n'
  else
    printf '9002\\n'
  fi
}
sleep() { :; }
pid="$(wait_for_child_pid 4242 "sidecar pattern")"
printf 'pid=%s\\n' "$pid"
`;
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pid=9001");
  });

  it("keeps every lifecycle sidecar lookup scoped to its owning app", () => {
    const root = path.resolve(directory, "../..");
    const script = fs.readFileSync(
      path.join(root, "scripts/macos/run-lifecycle-e2e.sh"),
      "utf8",
    );
    const launchFunction = loadShellFunction(script, "launch_app");
    const harness = `${launchFunction}
app_pid=""
sidecar_pid=""
APP_BUNDLE="/tmp/Levil Notes.app"
APP_EXECUTABLE="/tmp/Levil Notes.app/Contents/MacOS/SpaceNotes"
SIDECAR_PATTERN="/tmp/node /tmp/sidecar-entry.cjs"
pgrep() {
  return 1
}
open() { :; }
wait_for_new_pid() {
  printf '4242\\n'
}
wait_for_child_pid() {
  [[ "$1" == "4242" && "$2" == "$SIDECAR_PATTERN" ]] || return 71
  printf '9001\\n'
}
wait_for_log_marker() { :; }
launch_app 0
printf 'app=%s sidecar=%s\\n' "$app_pid" "$sidecar_pid"
`;
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("app=4242 sidecar=9001");

    const replacementStart = script.indexOf('replacement_sidecar_pid="$(');
    expect(replacementStart).toBeGreaterThan(0);
    const replacementEnd = script.indexOf(")\n", replacementStart);
    const replacementBlock = script.slice(replacementStart, replacementEnd);
    expect(replacementBlock).toContain("wait_for_child_pid \\");
    expect(replacementBlock).toContain('"$crash_app_pid"');
    expect(replacementBlock).toContain('"$original_sidecar_pid"');
    expect(script).toContain(
      'if pgrep -P "$crash_app_pid" -f "$SIDECAR_PATTERN"',
    );
    expect(script).not.toContain('pgrep -n -f "$SIDECAR_PATTERN"');
  });

  it("exercises DMG retry recovery and exhaustion without real hdiutil", () => {
    const root = path.resolve(directory, "../..");
    const script = fs.readFileSync(
      path.join(root, "scripts/build-macos-universal.sh"),
      "utf8",
    );
    const retryFunction = loadShellFunction(script, "retry_hdiutil");
    const runRetry = (succeedsAt) =>
      spawnSync(
        "bash",
        [
          "-c",
          `${retryFunction}
count=0
hdiutil() {
  count=$((count + 1))
  [[ "$count" -ge ${succeedsAt} ]]
}
retry_hdiutil verify 5 0 /tmp/test.dmg
printf 'count=%s result=%s\\n' "$count" "$?"
`,
        ],
        { encoding: "utf8" },
      );

    const recovered = runRetry(3);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("count=3 result=0");

    const exhausted = runRetry(99);
    expect(exhausted.status).toBe(0);
    expect(exhausted.stdout).toContain("count=5 result=1");
    expect(exhausted.stderr).toContain("failed after 5 attempts");
  });

  it("detaches a partial mount before retrying DMG attachment", () => {
    const root = path.resolve(directory, "../..");
    const script = fs.readFileSync(
      path.join(root, "scripts/build-macos-universal.sh"),
      "utf8",
    );
    const activeFunction = loadShellFunction(script, "mount_point_is_active");
    const detachFunction = loadShellFunction(script, "detach_mount_point");
    const attachFunction = loadShellFunction(script, "attach_dmg");
    const harness = `${activeFunction}
${detachFunction}
${attachFunction}
mount_point=/tmp/test-mount
DMG_PATH=/tmp/test.dmg
attach_count=0
detach_count=0
mounted=0
events=()
mount_point_is_active() { [[ "$mounted" == 1 ]]; }
hdiutil() {
  if [[ "$1" == "attach" ]]; then
    events+=(attach)
    attach_count=$((attach_count + 1))
    if [[ "$attach_count" -ge 3 ]]; then
      return 0
    fi
    mounted=1
    return 1
  fi
  if [[ "$1" == "detach" ]]; then
    events+=(detach)
    detach_count=$((detach_count + 1))
    mounted=0
    return 0
  fi
  return 9
}
sleep() { :; }
attach_dmg
printf 'attach=%s detach=%s result=%s events=%s\\n' \
  "$attach_count" "$detach_count" "$?" "$(IFS=,; echo "\${events[*]}")"
`;
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "attach=3 detach=2 result=0 events=attach,detach,attach,detach,attach",
    );
  });

  it("fails closed when a partial mount cannot be detached", () => {
    const root = path.resolve(directory, "../..");
    const script = fs.readFileSync(
      path.join(root, "scripts/build-macos-universal.sh"),
      "utf8",
    );
    const activeFunction = loadShellFunction(script, "mount_point_is_active");
    const detachFunction = loadShellFunction(script, "detach_mount_point");
    const attachFunction = loadShellFunction(script, "attach_dmg");
    const harness = `${activeFunction}
${detachFunction}
${attachFunction}
mount_point=/tmp/test-mount
DMG_PATH=/tmp/test.dmg
attach_count=0
detach_count=0
mounted=0
mount_point_is_active() { [[ "$mounted" == 1 ]]; }
hdiutil() {
  if [[ "$1" == "attach" ]]; then
    attach_count=$((attach_count + 1))
    mounted=1
    return 1
  fi
  if [[ "$1" == "detach" ]]; then
    detach_count=$((detach_count + 1))
    return 1
  fi
  return 9
}
sleep() { :; }
attach_dmg
printf 'attach=%s detach=%s result=%s\\n' \
  "$attach_count" "$detach_count" "$?"
`;
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("attach=1 detach=3 result=1");
    expect(result.stderr).toContain(
      "cannot safely retry hdiutil attach with a dirty mount point",
    );
  });

  it("retries and verifies Intel DMG teardown", () => {
    const root = path.resolve(directory, "../..");
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/build-macos.yml"),
      "utf8",
    );
    const detachFunction = loadShellFunction(workflow, "detach_dmg_mount");
    const runDetach = ({ succeedsAt, infoFails = false }) =>
      spawnSync(
        "bash",
        [
          "-c",
          `${detachFunction}
active=1
detach_calls=0
hdiutil() {
  if [[ "$1" == "info" ]]; then
    [[ "${infoFails ? "1" : "0"}" == 1 ]] && return 2
    [[ "$active" == 1 ]] && printf 'mounted at /tmp/test-mount\\n'
    return 0
  fi
  if [[ "$1" == "detach" ]]; then
    detach_calls=$((detach_calls + 1))
    if [[ "$detach_calls" -ge ${succeedsAt} ]]; then
      active=0
      return 0
    fi
    return 1
  fi
  return 9
}
sleep() { :; }
detach_dmg_mount /tmp/test-mount 3
printf 'detach=%s active=%s result=%s\\n' \\
  "$detach_calls" "$active" "$?"
`,
        ],
        { encoding: "utf8" },
      );

    const recovered = runDetach({ succeedsAt: 3 });
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("detach=3 active=0 result=0");

    const exhausted = runDetach({ succeedsAt: 99 });
    expect(exhausted.status).toBe(0);
    expect(exhausted.stdout).toContain("detach=3 active=1 result=1");

    const queryFailed = runDetach({ succeedsAt: 1, infoFails: true });
    expect(queryFailed.status).toBe(0);
    expect(queryFailed.stdout).toContain("detach=0 active=1 result=1");
    expect(queryFailed.stderr).toContain("failed to query mounted disk images");
  });

  it("preserves the original exit code through Intel DMG cleanup", () => {
    const root = path.resolve(directory, "../..");
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/build-macos.yml"),
      "utf8",
    );
    const cleanupFunction = loadShellFunction(workflow, "cleanup_mount");
    const runCleanup = (originalStatus, detachSucceeds) =>
      spawnSync(
        "bash",
        [
          "-c",
          `${cleanupFunction}
mount_point=/tmp/test-mount
detach_dmg_mount() { return ${detachSucceeds ? "0" : "1"}; }
trap cleanup_mount EXIT
exit ${originalStatus}
`,
        ],
        { encoding: "utf8" },
      );

    expect(runCleanup(0, true).status).toBe(0);
    expect(runCleanup(0, false).status).toBe(1);
    expect(runCleanup(16, false).status).toBe(16);
  });

});

describeMac("macOS E2E runner behavior", () => {
  it("requires the packaged app to permit the local sidecar connection", () => {
    const root = path.resolve(directory, "../..");
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "spacenotes-bundle-contract-"),
    );
    const app = path.join(temporaryRoot, "Levil Notes.app");
    const contents = path.join(app, "Contents");
    const executable = path.join(contents, "MacOS", "SpaceNotes");
    const infoPlist = path.join(contents, "Info.plist");
    const source = path.join(temporaryRoot, "main.c");
    const manifest = path.join(temporaryRoot, "architectures.txt");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(source, "int main(void) { return 0; }\n");
    execFileSync("clang", [
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-o",
      executable,
      source,
    ]);

    const writeInfoPlist = (allowsLocalNetworking) => {
      fs.writeFileSync(
        infoPlist,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <${allowsLocalNetworking ? "true" : "false"}/>
  </dict>
</dict>
</plist>
`,
      );
    };
    const verify = () =>
      spawnSync(
        path.join(root, "scripts/verify-macos-bundle.sh"),
        [app, manifest],
        { encoding: "utf8" },
      );

    writeInfoPlist(true);
    expect(verify()).toMatchObject({ status: 0 });

    writeInfoPlist(false);
    const rejected = verify();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("未允许本地网络访问");
  });

  it("redacts mixed-case tokens and complex Bearer credentials", () => {
    const output = execFileSync(
      path.join(directory, "redact-log.sh"),
      [],
      {
        encoding: "utf8",
        input: [
          "TOKEN=abc123",
          "token=def456&next=visible",
          "bearer abc+def/ghi==",
          "Bearer xyz.123_-",
          "safe text",
        ].join("\n"),
      },
    );
    expect(output).toContain("TOKEN=[redacted]");
    expect(output).toContain("token=[redacted]");
    expect(output).toContain("bearer [redacted]");
    expect(output).toContain("Bearer [redacted]");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("def456");
    expect(output).not.toContain("abc+def/ghi==");
    expect(output).not.toContain("xyz.123_-");
    expect(output).toContain("next=visible");
    expect(output).toContain("safe text");
  });

  it("keeps failed-run diagnostics scoped, redacted, and restorable", () => {
    const root = path.resolve(directory, "../..");
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "spacenotes-e2e-contract-"),
    );
    const home = path.join(temporaryRoot, "home");
    const support = path.join(home, "Library/Application Support/Levil Notes");
    const app = path.join(temporaryRoot, "Levil Notes.app");
    const executable = path.join(app, "Contents/MacOS/SpaceNotes");
    const report = path.join(temporaryRoot, "e2e-wkwebview.json");
    const diagnostics = path.join(temporaryRoot, "diagnostics.log");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.mkdirSync(support, { recursive: true });
    fs.writeFileSync(
      path.join(support, "settings.json"),
      '{"recentVault":"original"}\n',
    );
    fs.writeFileSync(
      path.join(support, "diagnostics.log"),
      "old-history TOKEN=old-secret\n",
    );
    fs.writeFileSync(
      executable,
      `#!/bin/bash
set -euo pipefail
report=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--e2e-report" ]]; then
    report="$2"
    shift 2
  else
    shift
  fi
done
printf '%s\\n' '{"status":"NOT CERTIFIED","failures":[{"message":"TOKEN=report-secret"}' > "$report"
printf '%s\\n' 'new-run bearer abc+def/ghi==' >> "$HOME/Library/Application Support/Levil Notes/diagnostics.log"
`,
    );
    fs.chmodSync(executable, 0o755);

    const result = spawnSync(
      path.join(directory, "run-wkwebview-e2e.sh"),
      [
        app,
        report,
        path.join(temporaryRoot, "missing.dmg"),
        diagnostics,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        timeout: 20_000,
      },
    );

    expect(result.status).toBe(1);
    expect(fs.readFileSync(report, "utf8")).toContain(
      "TOKEN=[redacted]",
    );
    const evidence = fs.readFileSync(diagnostics, "utf8");
    expect(evidence).toContain("new-run bearer [redacted]");
    expect(evidence).not.toContain("old-history");
    expect(evidence).not.toContain("report-secret");
    expect(evidence).not.toContain("abc+def/ghi==");
    expect(
      fs.readFileSync(path.join(support, "settings.json"), "utf8"),
    ).toBe('{"recentVault":"original"}\n');
  });

  it("cleans up the app and settings when the runner receives SIGTERM", async () => {
    const root = path.resolve(directory, "../..");
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "spacenotes-e2e-signal-"),
    );
    const home = path.join(temporaryRoot, "home");
    const support = path.join(home, "Library/Application Support/Levil Notes");
    const app = path.join(temporaryRoot, "Levil Notes.app");
    const executable = path.join(app, "Contents/MacOS/SpaceNotes");
    const report = path.join(temporaryRoot, "e2e-wkwebview.json");
    const diagnostics = path.join(temporaryRoot, "diagnostics.log");
    const appPidFile = path.join(temporaryRoot, "app.pid");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.mkdirSync(support, { recursive: true });
    fs.writeFileSync(
      path.join(support, "settings.json"),
      '{"recentVault":"signal-test"}\n',
    );
    fs.writeFileSync(
      executable,
      `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$$" > "$SPACENOTES_E2E_TEST_PID_FILE"
exec sleep 30
`,
    );
    fs.chmodSync(executable, 0o755);

    const child = spawn(
      path.join(directory, "run-wkwebview-e2e.sh"),
      [
        app,
        report,
        path.join(temporaryRoot, "missing.dmg"),
        diagnostics,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: home,
          SPACENOTES_E2E_TEST_PID_FILE: appPidFile,
        },
        stdio: "ignore",
      },
    );
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (fs.existsSync(appPidFile)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(fs.existsSync(appPidFile)).toBe(true);
    const appPid = Number(fs.readFileSync(appPidFile, "utf8").trim());
    child.kill("SIGTERM");
    const result = await new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    expect(result).toEqual({ code: 143, signal: null });
    expect(() => process.kill(appPid, 0)).toThrow();
    expect(
      fs.readFileSync(path.join(support, "settings.json"), "utf8"),
    ).toBe('{"recentVault":"signal-test"}\n');
    expect(fs.existsSync(diagnostics)).toBe(true);
  }, 20_000);
});
