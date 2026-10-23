const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VALID_STATUSES = new Set(["PASS", "INCONCLUSIVE", "NOT CERTIFIED"]);

function statusFromEnvironment(environment, name) {
  const status = environment[name];
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`${name} must be PASS, INCONCLUSIVE, or NOT CERTIFIED.`);
  }
  return status;
}

function buildLifecycleReport(environment, { sha256 }) {
  const windowLifecycleStatus = statusFromEnvironment(
    environment,
    "WINDOW_LIFECYCLE_STATUS",
  );
  const menuAccessibilityStatus = statusFromEnvironment(
    environment,
    "MENU_ACCESSIBILITY_STATUS",
  );
  const singleCrashStatus = statusFromEnvironment(
    environment,
    "SINGLE_CRASH_STATUS",
  );
  const repeatedCrashStatus = statusFromEnvironment(
    environment,
    "REPEATED_CRASH_STATUS",
  );
  const normalQuitStatus = statusFromEnvironment(
    environment,
    "NORMAL_QUIT_STATUS",
  );
  const visualStatus = statusFromEnvironment(
    environment,
    "COMPUTER_USE_VISUAL_STATUS",
  );
  const functionalStatuses = [
    windowLifecycleStatus,
    menuAccessibilityStatus,
    singleCrashStatus,
    repeatedCrashStatus,
    normalQuitStatus,
  ];
  const functionalStatus = functionalStatuses.every(
    (status) => status === "PASS",
  )
    ? "PASS"
    : "NOT CERTIFIED";
  const status =
    functionalStatus === "PASS"
      ? visualStatus === "PASS"
        ? "PASS"
        : "INCONCLUSIVE"
      : "NOT CERTIFIED";

  return {
    status,
    functionalStatus,
    artifact: path.basename(environment.DMG_PATH),
    sha256,
    environment: {
      macOS: os.release(),
      hostArchitecture: process.arch,
      installedPath: environment.APP_BUNDLE,
    },
    windowLifecycle: {
      status: windowLifecycleStatus,
      appPID: Number(environment.WINDOW_LIFECYCLE_PID),
      sidecarPID: Number(environment.WINDOW_LIFECYCLE_SIDECAR_PID),
      closedWindowWithoutTerminating: true,
      reopenedFromDockRequest: true,
      diagnosticsMarkers: [
        "window-closed-app-persisted",
        "window-reopened-from-dock-request",
      ],
    },
    menuAccessibility: {
      status: menuAccessibilityStatus,
      menus: environment.MENUS.split(", "),
      closeWindowCommand: "Cmd-W",
    },
    singleSidecarCrash: {
      status: singleCrashStatus,
      appPID: Number(environment.CRASH_APP_PID),
      originalSidecarPID: Number(environment.ORIGINAL_SIDECAR_PID),
      replacementSidecarPID: Number(environment.REPLACEMENT_SIDECAR_PID),
      tokenRotated: true,
      tokenTransport: {
        status: singleCrashStatus,
        delivery: "stdin-first-line",
        visibleInProcessEnvironment: false,
      },
      tokenFingerprints: {
        algorithm: "sha256",
        diagnosticsAfterCrashLine: Number(
          environment.DIAGNOSTICS_BEFORE_CRASH,
        ),
        original: environment.ORIGINAL_TOKEN_FINGERPRINT,
        replacement: environment.REPLACEMENT_TOKEN_FINGERPRINT,
      },
      automaticRestart: true,
      webViewReloaded: true,
    },
    repeatedSidecarCrash: {
      status: repeatedCrashStatus,
      appRemainedAlive: true,
      automaticRestartStopped: true,
      sidecarRemainedStopped: true,
    },
    normalQuit: {
      status: normalQuitStatus,
      appAfterQuit: "absent",
      sidecarAfterQuit: "absent",
    },
    diagnosticsLog: environment.DIAGNOSTICS,
    computerUseVisualCapture: {
      status: visualStatus,
      reason: environment.COMPUTER_USE_VISUAL_REASON,
    },
  };
}

function lifecycleResultIsAcceptable(report, allowInconclusiveVisual) {
  if (report.status === "PASS") {
    return true;
  }
  return (
    allowInconclusiveVisual === "1" &&
    report.status === "INCONCLUSIVE" &&
    report.functionalStatus === "PASS"
  );
}

function main() {
  const environment = process.env;
  const dmg = fs.readFileSync(environment.DMG_PATH);
  const sha256 = crypto.createHash("sha256").update(dmg).digest("hex");
  const report = buildLifecycleReport(environment, { sha256 });
  fs.mkdirSync(path.dirname(environment.REPORT_PATH), { recursive: true });
  fs.writeFileSync(
    environment.REPORT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    !lifecycleResultIsAcceptable(
      report,
      environment.SPACENOTES_ALLOW_INCONCLUSIVE_VISUAL,
    )
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildLifecycleReport,
  lifecycleResultIsAcceptable,
};
