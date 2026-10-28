const { contextBridge, ipcRenderer } = require("electron");

// The renderer only receives a narrow, explicit API surface. No direct Node or
// filesystem handles are exposed to note content.
contextBridge.exposeInMainWorld("levilNotes", {
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  restoreVault: () => ipcRenderer.invoke("vault:restore"),
  getVaultSnapshot: () => ipcRenderer.invoke("vault:snapshot"),
  readNote: (relativePath) => ipcRenderer.invoke("note:read", relativePath),
  writeNote: (relativePath, content) =>
    ipcRenderer.invoke("note:write", relativePath, content),
  createNote: (parentPath, title) =>
    ipcRenderer.invoke("note:create", parentPath, title),
  trashNote: (relativePath) =>
    ipcRenderer.invoke("note:trash", relativePath),
  renameNote: (relativePath, title) =>
    ipcRenderer.invoke("note:rename", relativePath, title),
  renameDirectory: (relativePath, name) =>
    ipcRenderer.invoke("directory:rename", relativePath, name),
  trashDirectory: (relativePath) =>
    ipcRenderer.invoke("directory:trash", relativePath),
  getNoteHistory: (relativePath) =>
    ipcRenderer.invoke("note:history", relativePath),

  search: (query, scope, mode) =>
    ipcRenderer.invoke("search:run", query, scope, mode),
  getOutline: (relativePath) =>
    ipcRenderer.invoke("note:outline", relativePath),
  getBacklinks: (relativePath) =>
    ipcRenderer.invoke("note:backlinks", relativePath),
  getTags: () => ipcRenderer.invoke("tags:list"),

  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitDiff: (relativePath) => ipcRenderer.invoke("git:diff", relativePath),
  gitStage: (paths, staged) =>
    ipcRenderer.invoke("git:stage", paths, staged),
  gitCommit: (message, selectedPaths) =>
    ipcRenderer.invoke("git:commit", message, selectedPaths),
  gitPreviewCommit: (selectedPaths) =>
    ipcRenderer.invoke("git:preview-commit", selectedPaths),
  gitFetch: () => ipcRenderer.invoke("git:fetch"),
  gitPull: () => ipcRenderer.invoke("git:pull"),
  gitPush: () => ipcRenderer.invoke("git:push"),
  gitDiscard: (paths) => ipcRenderer.invoke("git:discard", paths),
  gitBranches: () => ipcRenderer.invoke("git:branches"),
  gitCreateBranch: (name) =>
    ipcRenderer.invoke("git:create-branch", name),
  gitCheckoutBranch: (name) =>
    ipcRenderer.invoke("git:checkout-branch", name),
  gitIgnoreState: () => ipcRenderer.invoke("git:ignore-state"),
  gitAddIgnore: (options) =>
    ipcRenderer.invoke("git:add-ignore", options),
  gitRemoveIgnore: (scope, line) =>
    ipcRenderer.invoke("git:remove-ignore", scope, line),
  gitLog: (relativePath) => ipcRenderer.invoke("git:log", relativePath),
  gitShow: (hash) => ipcRenderer.invoke("git:show", hash),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (updates) => ipcRenderer.invoke("settings:save", updates),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text) =>
    ipcRenderer.invoke("clipboard:write-text", text),
  showInFolder: (relativePath) =>
    ipcRenderer.invoke("app:show-in-folder", relativePath),

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),

  onVaultChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.removeListener("vault:changed", listener);
  },
});
