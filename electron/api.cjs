const IPC_METHODS = Object.freeze({
  "vault:choose": "chooseVault",
  "vault:restore": "restoreVault",
  "vault:snapshot": "getVaultSnapshot",
  "note:read": "readNote",
  "note:write": "writeNote",
  "note:create": "createNote",
  "note:trash": "trashNote",
  "note:rename": "renameNote",
  "note:save-attachment": "saveAttachment",
  "directory:rename": "renameDirectory",
  "directory:trash": "trashDirectory",
  "note:history": "getNoteHistory",
  "search:run": "search",
  "note:outline": "getOutline",
  "note:backlinks": "getBacklinks",
  "tags:list": "getTags",
  "git:status": "gitStatus",
  "git:diff": "gitDiff",
  "git:stage": "gitStage",
  "git:commit": "gitCommit",
  "git:preview-commit": "gitPreviewCommit",
  "git:fetch": "gitFetch",
  "git:pull": "gitPull",
  "git:push": "gitPush",
  "git:discard": "gitDiscard",
  "git:branches": "gitBranches",
  "git:create-branch": "gitCreateBranch",
  "git:checkout-branch": "gitCheckoutBranch",
  "git:ignore-state": "gitIgnoreState",
  "git:add-ignore": "gitAddIgnore",
  "git:remove-ignore": "gitRemoveIgnore",
  "git:log": "gitLog",
  "git:show": "gitShow",
  "settings:get": "getSettings",
  "settings:save": "saveSettings",
  "clipboard:read-text": "readClipboardText",
  "clipboard:read-image": "readClipboardImage",
  "clipboard:write-text": "writeClipboardText",
  "app:show-in-folder": "showInFolder",
  "window:minimize": "minimizeWindow",
  "window:toggle-maximize": "toggleMaximizeWindow",
  "window:close": "closeWindow",
  "app:open-path": "openPath",
  "update:state": "getUpdateState",
  "update:check": "checkForUpdate",
  "update:download": "downloadUpdate",
  "update:cancel": "cancelUpdate",
  "update:install": "installUpdate",
  "update:release-page": "openUpdateReleasePage",
});

function hostAction(hostActions, name) {
  const action = hostActions?.[name];
  if (typeof action !== "function") {
    throw new Error(`当前宿主不支持 ${name}。`);
  }
  return action;
}

/**
 * Creates the platform-neutral method surface used by Electron IPC and the
 * macOS sidecar. Shell-owned actions are injected so business services never
 * import Electron directly.
 */
function createLevilNotesApi({
  vaultService,
  gitService,
  settingsStore,
  hostActions,
  updateService = null,
}) {
  const requireUpdateService = () => {
    if (!updateService) {
      throw new Error("当前环境不支持更新检查。");
    }
    return updateService;
  };

  return Object.freeze({
    chooseVault: async () => {
      const selectedPath = await hostAction(
        hostActions,
        "chooseVaultFolder",
      )();
      return selectedPath ? vaultService.open(selectedPath) : null;
    },
    restoreVault: () => vaultService.restore(),
    getVaultSnapshot: () => vaultService.snapshot("manual"),
    readNote: (relativePath) => vaultService.readNote(relativePath),
    writeNote: (relativePath, content) =>
      vaultService.writeNote(relativePath, content),
    createNote: (parentPath, title) =>
      vaultService.createNote(parentPath, title),
    saveAttachment: (notePath, payload) =>
      vaultService.saveAttachment(notePath, payload),
    trashNote: (relativePath) => vaultService.trashNote(relativePath),
    renameNote: (relativePath, title) =>
      vaultService.renameNote(relativePath, title),
    renameDirectory: (relativePath, name) =>
      vaultService.renameDirectory(relativePath, name),
    trashDirectory: (relativePath) =>
      vaultService.trashDirectory(relativePath),
    getNoteHistory: (relativePath) => gitService.log(relativePath),

    search: (query, scope, mode) =>
      vaultService.search(query, scope, mode),
    getOutline: (relativePath) => vaultService.outline(relativePath),
    getBacklinks: (relativePath) => vaultService.backlinks(relativePath),
    getTags: () => vaultService.tags(),

    gitStatus: () => gitService.status(),
    gitDiff: (relativePath) => gitService.diff(relativePath),
    gitStage: (paths, staged) => gitService.stage(paths, staged),
    gitCommit: (message, selectedPaths) =>
      gitService.commit(message, selectedPaths),
    gitPreviewCommit: (selectedPaths) =>
      gitService.previewCommit(selectedPaths),
    gitFetch: () => gitService.fetch(),
    gitPull: () => gitService.pull(),
    gitPush: () => gitService.push(),
    gitDiscard: (paths) => gitService.discard(paths),
    gitBranches: () => gitService.branches(),
    gitCreateBranch: (name) => gitService.createBranch(name),
    gitCheckoutBranch: (name) => gitService.checkoutBranch(name),
    gitIgnoreState: () => gitService.ignoreState(),
    gitAddIgnore: (options) => gitService.addIgnore(options),
    gitRemoveIgnore: (scope, line) =>
      gitService.removeIgnore(scope, line),
    gitLog: (relativePath) => gitService.log(relativePath),
    gitShow: (hash) => gitService.show(hash),

    getSettings: () => settingsStore.get(),
    saveSettings: async (updates) => {
      const previousShowHidden = settingsStore.get().showHiddenFiles;
      const nextSettings = await settingsStore.save(updates);
      if (
        settingsStore.get().recentVault &&
        previousShowHidden !== nextSettings.showHiddenFiles
      ) {
        await vaultService.refreshIndex();
      }
      return nextSettings;
    },
    readClipboardText: () =>
      hostAction(hostActions, "readClipboardText")(),
    readClipboardImage: () =>
      hostAction(hostActions, "readClipboardImage")(),
    writeClipboardText: (text) =>
      hostAction(hostActions, "writeClipboardText")(text),
    showInFolder: (relativePath) => {
      if (relativePath) {
        hostAction(hostActions, "showInFolder")(relativePath);
      }
    },

    minimizeWindow: () => hostAction(hostActions, "minimizeWindow")(),
    toggleMaximizeWindow: () =>
      hostAction(hostActions, "toggleMaximizeWindow")(),
    closeWindow: () => hostAction(hostActions, "closeWindow")(),
    openPath: (target) => {
      if (typeof target !== "string" || !target) {
        throw new Error("路径无效。");
      }
      return hostAction(hostActions, "openPath")(target);
    },

    getUpdateState: () => requireUpdateService().getState(),

    checkForUpdate: (options = {}) =>
      requireUpdateService().check({
        force: Boolean(options && options.force),
        silent: Boolean(options && options.silent),
      }),

    downloadUpdate: () => requireUpdateService().download(),
    cancelUpdate: () => requireUpdateService().cancel(),

    /**
     * 由宿主决定怎么打开安装包：Electron 有 shell.openPath，可以直接装；
     * macOS sidecar 没有打开能力，把路径交回渲染层走宿主桥。
     */
    installUpdate: async () => {
      const service = requireUpdateService();
      const plan = service.installPlan();
      const open =
        hostActions && typeof hostActions.openPath === "function"
          ? hostActions.openPath
          : null;
      if (!open) {
        return {
          ...service.getState(),
          opened: false,
          target: plan.target,
        };
      }
      await open(plan.target);
      if (plan.quitAfterInstall) {
        setTimeout(() => {
          try {
            hostActions.quitApp?.();
          } catch {
            // 退出失败不影响安装器已经启动。
          }
        }, 400);
      }
      return { ...service.getState(), opened: true };
    },

    openUpdateReleasePage: async () => {
      const service = requireUpdateService();
      const url = service.releasePageUrl();
      const open =
        hostActions && typeof hostActions.openPath === "function"
          ? hostActions.openPath
          : null;
      if (!open) {
        return { opened: false, url };
      }
      await open(url);
      return { opened: true, url };
    },
  });
}

function registerIpcHandlers(ipcMain, api) {
  for (const [channel, method] of Object.entries(IPC_METHODS)) {
    ipcMain.handle(channel, (_event, ...args) => api[method](...args));
  }
}

module.exports = {
  IPC_METHODS,
  createLevilNotesApi,
  registerIpcHandlers,
};
