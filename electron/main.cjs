const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} = require("electron");
const {
  createLevilNotesApi,
  registerIpcHandlers,
} = require("./api.cjs");
const { GitService } = require("./git.cjs");
const { SettingsStore, VaultService } = require("./vault.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "notes-asset",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let settingsStore = null;
let vaultService = null;
let gitService = null;

function sendVaultChanged(snapshot) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("vault:changed", snapshot);
}

async function createWindow() {
  const settings = settingsStore.get();
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: settings.background,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) {
      return;
    }
    event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerAssetProtocol() {
  protocol.handle("notes-asset", async (request) => {
    try {
      const url = new URL(request.url);
      const target =
        url.searchParams.get("target") ||
        decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const notePath = url.searchParams.get("note") || "";
      const absolutePath = await vaultService.resolveAsset(target, notePath);
      return net.fetch(pathToFileURL(absolutePath).toString());
    } catch {
      return new Response("Asset not found", { status: 404 });
    }
  });
}

function createDesktopApi() {
  const hostActions = {
    chooseVaultFolder: async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "打开或新建笔记库文件夹",
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    },
    showInFolder: (relativePath) => {
      shell.showItemInFolder(vaultService.resolveInsideVault(relativePath));
    },
    minimizeWindow: () => mainWindow?.minimize(),
    toggleMaximizeWindow: () => {
      if (!mainWindow) {
        return;
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    },
    closeWindow: () => mainWindow?.close(),
  };

  return createLevilNotesApi({
    vaultService,
    gitService,
    settingsStore,
    hostActions,
  });
}

function registerDesktopIpcHandlers() {
  registerIpcHandlers(ipcMain, createDesktopApi());
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(
    path.join(app.getPath("userData"), "settings.json"),
  );
  await settingsStore.load();
  vaultService = new VaultService(settingsStore, sendVaultChanged, {
    trashItem: (absolutePath) => shell.trashItem(absolutePath),
  });
  gitService = new GitService(vaultService);

  registerAssetProtocol();
  registerDesktopIpcHandlers();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
