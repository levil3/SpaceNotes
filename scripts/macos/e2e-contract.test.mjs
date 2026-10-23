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
    expect(script).toContain("requiredFlows: 60");
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

    expect(workflow).toContain(
      'artifact/build/macos/"Levil Notes 0.2.0.dmg"',
    );
    expect(workflow).toContain(
      'cd artifact/build/macos',
    );
    expect(workflow).not.toContain(
      'artifact/"Levil Notes 0.2.0.dmg"',
    );
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
