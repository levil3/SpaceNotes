const IPC_METHODS = Object.freeze({
  "vault:choose": "chooseVault",
  "vault:restore": "restoreVault",
  "vault:snapshot": "getVaultSnapshot",
  "note:read": "readNote",
  "note:write": "writeNote",
  "note:create": "createNote",
  "note:trash": "trashNote",
  "note:rename": "renameNote",
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
  "app:show-in-folder": "showInFolder",
  "window:minimize": "minimizeWindow",
  "window:toggle-maximize": "toggleMaximizeWindow",
  "window:close": "closeWindow",
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
}) {
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
    trashNote: (relativePath) => vaultService.trashNote(relativePath),
    renameNote: (relativePath, title) =>
      vaultService.renameNote(relativePath, title),
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
    showInFolder: (relativePath) => {
      if (relativePath) {
        hostAction(hostActions, "showInFolder")(relativePath);
      }
    },

    minimizeWindow: () => hostAction(hostActions, "minimizeWindow")(),
    toggleMaximizeWindow: () =>
      hostAction(hostActions, "toggleMaximizeWindow")(),
    closeWindow: () => hostAction(hostActions, "closeWindow")(),
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
