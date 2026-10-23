const path = require("node:path");
const { createLevilNotesApi } = require("./api.cjs");
const { GitService } = require("./git.cjs");
const {
  createEventBroadcaster,
  createSidecarServer,
} = require("./sidecar.cjs");
const { SettingsStore, VaultService } = require("./vault.cjs");

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少 sidecar 环境变量 ${name}。`);
  }
  return value;
}

function reportLog(event, error) {
  process.stderr.write(
    `${JSON.stringify({
      type: "log",
      event,
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
}

async function main() {
  const token = requiredEnvironment("SPACENOTES_TOKEN");
  const settingsPath = requiredEnvironment("SPACENOTES_SETTINGS_PATH");
  const webRoot = path.resolve(
    requiredEnvironment("SPACENOTES_WEB_ROOT"),
  );
  const allowedOrigins = String(
    process.env.SPACENOTES_ALLOWED_ORIGINS || "",
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const parentPID = Number(process.env.SPACENOTES_PARENT_PID || 0);

  const settingsStore = new SettingsStore(settingsPath);
  await settingsStore.load();

  const broadcaster = createEventBroadcaster();
  const vaultService = new VaultService(
    settingsStore,
    (snapshot) => broadcaster.broadcast(snapshot),
  );
  const gitService = new GitService(vaultService);
  const unsupportedHostAction = async () => {
    throw new Error("该动作由 macOS 原生宿主处理。");
  };
  const sharedApi = createLevilNotesApi({
    vaultService,
    gitService,
    settingsStore,
    hostActions: {
      chooseVaultFolder: unsupportedHostAction,
      showInFolder: unsupportedHostAction,
      minimizeWindow: unsupportedHostAction,
      toggleMaximizeWindow: unsupportedHostAction,
      closeWindow: unsupportedHostAction,
    },
  });
  const api = {
    ...sharedApi,
    openVault: (rootPath) => vaultService.open(rootPath),
  };
  const sidecar = createSidecarServer({
    api,
    vaultService,
    webRoot,
    token,
    allowedOrigins,
    internalHandlers: {
      refresh: () => vaultService.refreshIndex(),
    },
    broadcaster,
    logger: reportLog,
  });

  const address = await sidecar.listen();
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      host: "127.0.0.1",
      port: address.port,
    })}\n`,
  );

  let stopping = false;
  const stop = async (exitCode = 0) => {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await vaultService.closeWatcher();
      await sidecar.close();
    } catch (error) {
      reportLog("shutdown-error", error);
      exitCode = 1;
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
  process.on("uncaughtException", (error) => {
    reportLog("uncaught-exception", error);
    void stop(1);
  });
  process.on("unhandledRejection", (error) => {
    reportLog("unhandled-rejection", error);
    void stop(1);
  });

  if (Number.isInteger(parentPID) && parentPID > 0) {
    const parentMonitor = setInterval(() => {
      try {
        process.kill(parentPID, 0);
      } catch {
        void stop(0);
      }
    }, 1000);
    parentMonitor.unref();
  }
}

main().catch((error) => {
  reportLog("startup-error", error);
  process.exit(1);
});
