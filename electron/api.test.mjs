import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLevilNotesApi } = require("./api.cjs");

function createFixture() {
  let settings = {
    showHiddenFiles: false,
    recentVault: "",
  };

  const vaultService = {
    open: vi.fn(async (rootPath) => ({ path: rootPath, reason: "opened" })),
    restore: vi.fn(async () => ({ path: "/notes", reason: "opened" })),
    snapshot: vi.fn(() => ({ path: "/notes", files: [] })),
    readNote: vi.fn(async (path) => ({ path, content: "# Note" })),
    writeNote: vi.fn(async () => ({ modifiedAt: 42 })),
    createNote: vi.fn(async (parent, title) => ({
      path: `${parent}/${title}.md`,
      content: `# ${title}`,
    })),
    trashNote: vi.fn(async () => {}),
    renameNote: vi.fn(async (_path, title) => ({ path: `${title}.md` })),
    search: vi.fn(() => []),
    outline: vi.fn(() => []),
    backlinks: vi.fn(() => []),
    tags: vi.fn(() => []),
    refreshIndex: vi.fn(async () => ({ path: "/notes", files: [] })),
    getVaultPath: vi.fn(() => "/notes"),
  };

  const gitService = {
    status: vi.fn(async () => ({ repository: true })),
    diff: vi.fn(async () => "diff"),
    stage: vi.fn(async () => ({ repository: true })),
    commit: vi.fn(async () => ({ output: "committed" })),
    previewCommit: vi.fn(async () => ({ output: "preview" })),
    fetch: vi.fn(async () => ({ output: "fetched" })),
    pull: vi.fn(async () => ({ output: "pulled" })),
    push: vi.fn(async () => ({ output: "pushed" })),
    discard: vi.fn(async () => ({ repository: true })),
    branches: vi.fn(async () => []),
    createBranch: vi.fn(async () => ({ output: "created" })),
    checkoutBranch: vi.fn(async () => ({ output: "checked out" })),
    ignoreState: vi.fn(async () => ({ rules: [] })),
    addIgnore: vi.fn(async () => ({ output: "ignored" })),
    removeIgnore: vi.fn(async () => ({ output: "removed" })),
    log: vi.fn(async () => []),
    show: vi.fn(async () => "commit"),
  };

  const settingsStore = {
    get: vi.fn(() => ({ ...settings })),
    save: vi.fn(async (updates) => {
      settings = { ...settings, ...updates };
      return { ...settings };
    }),
  };

  const hostActions = {
    chooseVaultFolder: vi.fn(async () => "/selected"),
    showInFolder: vi.fn(),
    minimizeWindow: vi.fn(),
    toggleMaximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
  };

  return {
    api: createLevilNotesApi({
      vaultService,
      gitService,
      settingsStore,
      hostActions,
    }),
    vaultService,
    gitService,
    settingsStore,
    hostActions,
  };
}

describe("shared LevilNotes API", () => {
  it("preserves vault and note request arguments", async () => {
    const { api, vaultService, hostActions } = createFixture();

    await expect(api.chooseVault()).resolves.toEqual({
      path: "/selected",
      reason: "opened",
    });
    await expect(api.readNote("notes/today.md")).resolves.toEqual({
      path: "notes/today.md",
      content: "# Note",
    });
    await api.createNote("notes", "Today");

    expect(hostActions.chooseVaultFolder).toHaveBeenCalledOnce();
    expect(vaultService.open).toHaveBeenCalledWith("/selected");
    expect(vaultService.readNote).toHaveBeenCalledWith("notes/today.md");
    expect(vaultService.createNote).toHaveBeenCalledWith("notes", "Today");
  });

  it("preserves Git request arguments and return values", async () => {
    const { api, gitService } = createFixture();

    await api.gitStage(["notes/today.md"], true);
    await api.gitCommit("note update", ["notes/today.md"]);
    await api.gitPreviewCommit(["notes/today.md"]);
    await api.gitRemoveIgnore("local", 4);

    expect(gitService.stage).toHaveBeenCalledWith(
      ["notes/today.md"],
      true,
    );
    expect(gitService.commit).toHaveBeenCalledWith("note update", [
      "notes/today.md",
    ]);
    expect(gitService.previewCommit).toHaveBeenCalledWith([
      "notes/today.md",
    ]);
    expect(gitService.removeIgnore).toHaveBeenCalledWith("local", 4);
  });

  it("propagates service failures without replacing their message", async () => {
    const { api, vaultService } = createFixture();
    vaultService.readNote.mockRejectedValueOnce(new Error("笔记不存在。"));

    await expect(api.readNote("missing.md")).rejects.toThrow("笔记不存在。");
  });

  it("refreshes the index when hidden-file visibility changes", async () => {
    const { api, settingsStore, vaultService } = createFixture();
    settingsStore.get.mockReturnValueOnce({
      showHiddenFiles: false,
      recentVault: "/notes",
    });
    settingsStore.get.mockReturnValueOnce({
      showHiddenFiles: true,
      recentVault: "/notes",
    });

    await api.saveSettings({ showHiddenFiles: true });

    expect(settingsStore.save).toHaveBeenCalledWith({
      showHiddenFiles: true,
    });
    expect(vaultService.refreshIndex).toHaveBeenCalledOnce();
  });

  it("delegates host-only actions without touching business services", async () => {
    const { api, hostActions, vaultService, gitService } = createFixture();

    api.showInFolder("notes/today.md");
    api.minimizeWindow();
    api.toggleMaximizeWindow();
    api.closeWindow();

    expect(hostActions.showInFolder).toHaveBeenCalledWith("notes/today.md");
    expect(hostActions.minimizeWindow).toHaveBeenCalledOnce();
    expect(hostActions.toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(hostActions.closeWindow).toHaveBeenCalledOnce();
    expect(vaultService.readNote).not.toHaveBeenCalled();
    expect(gitService.status).not.toHaveBeenCalled();
  });
});
