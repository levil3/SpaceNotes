const path = require("node:path");
const { createLevilNotesApi } = require("../../electron/api.cjs");
const {
  requireNativeFileOperations,
} = require("./file-operations.cjs");
const { GitService } = require("../../electron/git.cjs");
const {
  createEventBroadcaster,
  createSidecarServer,
} = require("./server.cjs");
const { SettingsStore, VaultService } = require("../../electron/vault.cjs");

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少 sidecar 环境变量 ${name}。`);
  }
  return value;
}

function readLaunchTokens(stream = process.stdin) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const tokens = {};
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      stream.pause();
      callback();
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 4096) {
        finish(() => reject(new Error("sidecar 启动令牌过长。")));
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        for (const [environmentName, key] of [
          ["SPACENOTES_TOKEN", "token"],
          ["SPACENOTES_INTERNAL_TOKEN", "internalToken"],
        ]) {
          const prefix = `${environmentName}=`;
          if (!line.startsWith(prefix)) {
            continue;
          }
          const value = line.slice(prefix.length);
          if (!value || value.length > 1024) {
            finish(() => reject(new Error("sidecar 启动令牌无效。")));
            return;
          }
          tokens[key] = value;
        }
        if (tokens.token && tokens.internalToken) {
          finish(() => resolve(tokens));
          return;
        }
      }
    };
    const onEnd = () => {
      finish(() => reject(new Error("sidecar 未收到启动令牌。")));
    };
    const onError = (error) => {
      finish(() => reject(error));
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("sidecar 启动令牌读取超时。")));
    }, 5000);
    stream.setEncoding("utf8");
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    stream.resume();
  });
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
  const { token, internalToken } = await readLaunchTokens();
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
  const helperPath =
    process.env.SPACENOTES_FS_HELPER ||
    path.resolve(__dirname, "../../space-notes-fs");
  const fileOperations =
    process.platform === "darwin"
      ? requireNativeFileOperations(helperPath)
      : null;

  const settingsStore = new SettingsStore(settingsPath);
  await settingsStore.load();

  const broadcaster = createEventBroadcaster();
  const vaultService = new VaultService(
    settingsStore,
    (snapshot) => broadcaster.broadcast(snapshot),
    { fileOperations },
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
  const api = sharedApi;
  const sidecar = createSidecarServer({
    api,
    vaultService,
    webRoot,
    token,
    internalToken,
    allowedOrigins,
    internalHandlers: {
      openVault: (rootPath) => vaultService.open(rootPath),
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

module.exports = { readLaunchTokens };
