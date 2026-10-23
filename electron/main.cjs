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

function registerIpcHandlers() {
  ipcMain.handle("vault:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开或新建笔记库文件夹",
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return vaultService.open(result.filePaths[0]);
  });

  ipcMain.handle("vault:restore", () => vaultService.restore());
  ipcMain.handle("vault:snapshot", () => vaultService.snapshot("manual"));
  ipcMain.handle("note:read", (_event, relativePath) =>
    vaultService.readNote(relativePath),
  );
  ipcMain.handle("note:write", (_event, relativePath, content) =>
    vaultService.writeNote(relativePath, content),
  );
  ipcMain.handle("note:create", (_event, parentPath, title) =>
    vaultService.createNote(parentPath, title),
  );
  ipcMain.handle("note:trash", (_event, relativePath) =>
    vaultService.trashNote(relativePath),
  );
  ipcMain.handle("note:rename", (_event, relativePath, title) =>
    vaultService.renameNote(relativePath, title),
  );
  ipcMain.handle("note:history", (_event, relativePath) =>
    gitService.log(relativePath),
  );

  ipcMain.handle("search:run", (_event, query, scope, mode) =>
    vaultService.search(query, scope, mode),
  );
  ipcMain.handle("note:outline", (_event, relativePath) =>
    vaultService.outline(relativePath),
  );
  ipcMain.handle("note:backlinks", (_event, relativePath) =>
    vaultService.backlinks(relativePath),
  );
  ipcMain.handle("tags:list", () => vaultService.tags());

  ipcMain.handle("git:status", () => gitService.status());
  ipcMain.handle("git:diff", (_event, relativePath) =>
    gitService.diff(relativePath),
  );
  ipcMain.handle("git:stage", (_event, paths, staged) =>
    gitService.stage(paths, staged),
  );
  ipcMain.handle("git:commit", (_event, message, selectedPaths) =>
    gitService.commit(message, selectedPaths),
  );
  ipcMain.handle("git:fetch", () => gitService.fetch());
  ipcMain.handle("git:pull", () => gitService.pull());
  ipcMain.handle("git:push", () => gitService.push());
  ipcMain.handle("git:discard", (_event, paths) =>
    gitService.discard(paths),
  );
  ipcMain.handle("git:branches", () => gitService.branches());
  ipcMain.handle("git:create-branch", (_event, name) =>
    gitService.createBranch(name),
  );
  ipcMain.handle("git:checkout-branch", (_event, name) =>
    gitService.checkoutBranch(name),
  );
  ipcMain.handle("git:ignore-state", () => gitService.ignoreState());
  ipcMain.handle("git:add-ignore", (_event, options) =>
    gitService.addIgnore(options),
  );
  ipcMain.handle("git:remove-ignore", (_event, scope, line) =>
    gitService.removeIgnore(scope, line),
  );
  ipcMain.handle("git:log", (_event, relativePath) =>
    gitService.log(relativePath),
  );
  ipcMain.handle("git:show", (_event, hash) => gitService.show(hash));

  ipcMain.handle("settings:get", () => settingsStore.get());
  ipcMain.handle("settings:save", async (_event, updates) => {
    const previousShowHidden = settingsStore.get().showHiddenFiles;
    const nextSettings = await settingsStore.save(updates);

    // Hidden entries affect the shared note index used by files, search, tags
    // and backlinks, so rebuild only when this visibility setting changes.
    if (
      settingsStore.get().recentVault &&
      previousShowHidden !== nextSettings.showHiddenFiles
    ) {
      await vaultService.refreshIndex();
    }
    return nextSettings;
  });
  ipcMain.handle("app:show-in-folder", (_event, relativePath) => {
    if (relativePath) {
      shell.showItemInFolder(vaultService.resolveInsideVault(relativePath));
    }
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(
    path.join(app.getPath("userData"), "settings.json"),
  );
  await settingsStore.load();
  vaultService = new VaultService(settingsStore, sendVaultChanged);
  gitService = new GitService(vaultService);

  registerAssetProtocol();
  registerIpcHandlers();
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
