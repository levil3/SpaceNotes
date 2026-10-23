import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { SettingsStore, VaultService } = require("./vault.cjs");

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(platformActions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-"));
  temporaryDirectories.push(root);

  const noteDirectory = path.join(root, "notes", "Java Base");
  await fs.mkdir(noteDirectory, { recursive: true });
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  await fs.mkdir(path.join(noteDirectory, "images"), { recursive: true });
  await fs.writeFile(
    path.join(noteDirectory, "example.md"),
    "# Example\n\n![root](../../images/root.png)\n",
    "utf8",
  );
  await fs.writeFile(path.join(root, "images", "root.png"), "root", "utf8");
  await fs.writeFile(
    path.join(noteDirectory, "images", "local.png"),
    "local",
    "utf8",
  );

  const settings = new SettingsStore(path.join(root, "settings.json"));
  await settings.load();
  const vault = new VaultService(settings, () => {}, platformActions);
  await vault.open(root);
  return { root, vault };
}

describe("VaultService platform actions", () => {
  it("delegates a validated trash request and updates the index", async () => {
    const trashItem = vi.fn(async () => {});
    const { root, vault } = await createFixture({ trashItem });
    try {
      await vault.trashNote("notes/Java Base/example.md");

      expect(trashItem).toHaveBeenCalledWith(
        path.join(root, "notes", "Java Base", "example.md"),
      );
      expect(vault.snapshot().files.map((file) => file.path)).not.toContain(
        "notes/Java Base/example.md",
      );
    } finally {
      await vault.closeWatcher();
    }
  });

  it("rejects outside-vault paths before invoking the platform action", async () => {
    const trashItem = vi.fn(async () => {});
    const { vault } = await createFixture({ trashItem });
    try {
      await expect(vault.trashNote("../outside.md")).rejects.toThrow(
        "文件路径超出当前笔记库",
      );
      expect(trashItem).not.toHaveBeenCalled();
    } finally {
      await vault.closeWatcher();
    }
  });
});

describe("VaultService asset resolution", () => {
  it("resolves note-relative images that do not exist at the vault root", async () => {
    const { vault } = await createFixture();
    try {
      const resolved = await vault.resolveAsset(
        "images/local.png",
        "notes/Java Base/example.md",
      );
      expect(resolved).toBe(
        path.join(vault.getVaultPath(), "notes", "Java Base", "images", "local.png"),
      );
    } finally {
      await vault.closeWatcher();
    }
  });

  it("falls back to a unique attachment filename for stale relative paths", async () => {
    const { vault } = await createFixture();
    try {
      const resolved = await vault.resolveAsset(
        "..\\..\\..\\images\\root.png",
        "notes/Java Base/example.md",
      );
      expect(resolved).toBe(path.join(vault.getVaultPath(), "images", "root.png"));
    } finally {
      await vault.closeWatcher();
    }
  });

  it("rejects Windows absolute paths outside the vault", async () => {
    const { vault } = await createFixture();
    try {
      await expect(
        vault.resolveAsset("C:\\Windows\\example.png", "notes/example.md"),
      ).rejects.toThrow("图片路径无效");
    } finally {
      await vault.closeWatcher();
    }
  });
});

describe("VaultService hidden entries", () => {
  it("shows dot directories and notes only when the setting is enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-hidden-"));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, ".drafts", "archive"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "visible"), { recursive: true });
    await fs.mkdir(path.join(root, "empty"), { recursive: true });
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".drafts", "secret.md"),
      "# Secret\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".drafts", "archive", "old.md"),
      "# Old\n",
      "utf8",
    );
    await fs.writeFile(path.join(root, ".root.md"), "# Root\n", "utf8");
    await fs.writeFile(
      path.join(root, "visible", "note.md"),
      "# Visible\n",
      "utf8",
    );
    await fs.writeFile(path.join(root, ".git", "config"), "gitdir", "utf8");

    const settings = new SettingsStore(path.join(root, "settings.json"));
    await settings.load();
    const vault = new VaultService(settings, () => {});

    try {
      await vault.open(root);
      const initiallyVisible = vault.snapshot();
      expect(initiallyVisible.files.map((file) => file.path)).toEqual([
        "visible/note.md",
      ]);
      expect(initiallyVisible.directories).toContain("empty");
      expect(initiallyVisible.directories).not.toContain(".drafts");

      await settings.save({ showHiddenFiles: true });
      const withHidden = await vault.refreshIndex();
      expect(withHidden.files.map((file) => file.path)).toEqual([
        ".drafts/archive/old.md",
        ".drafts/secret.md",
        ".root.md",
        "visible/note.md",
      ]);
      expect(withHidden.directories).toEqual(
        expect.arrayContaining([".drafts", ".drafts/archive", "empty", "visible"]),
      );
      expect(withHidden.directories).not.toContain(".git");
    } finally {
      await vault.closeWatcher();
    }
  });
});

describe("SettingsStore appearance migration", () => {
  it("migrates the previous default layout to the denser revision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-settings-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        editorLineHeight: 1.9,
        contentWidth: 860,
        sidebarWidth: 284,
      }),
      "utf8",
    );

    const store = new SettingsStore(settingsPath);
    const settings = await store.load();

    expect(settings).toMatchObject({
      appearanceRevision: 4,
      editorLineHeight: 1.8,
      contentWidth: 1200,
      sidebarWidth: 320,
    });
  });

  it("preserves layout values the user already customized", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-settings-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        editorLineHeight: 2,
        contentWidth: 940,
        sidebarWidth: 300,
      }),
      "utf8",
    );

    const store = new SettingsStore(settingsPath);
    const settings = await store.load();

    expect(settings).toMatchObject({
      appearanceRevision: 4,
      editorLineHeight: 2,
      contentWidth: 940,
      sidebarWidth: 300,
    });
  });

  it("migrates the original purple palette to the neutral document palette", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-settings-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        appearanceRevision: 2,
        accent: "#6c59c6",
        background: "#ffffff",
        textColor: "#30343a",
      }),
      "utf8",
    );

    const store = new SettingsStore(settingsPath);
    const settings = await store.load();

    expect(settings).toMatchObject({
      appearanceRevision: 4,
      accent: "#4b708b",
      background: "#ffffff",
      textColor: "#333333",
    });
  });

  it("does not overwrite a custom color palette", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-settings-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        appearanceRevision: 2,
        accent: "#187a68",
        background: "#fbfcfa",
        textColor: "#28312d",
      }),
      "utf8",
    );

    const store = new SettingsStore(settingsPath);
    const settings = await store.load();

    expect(settings).toMatchObject({
      appearanceRevision: 4,
      accent: "#187a68",
      background: "#fbfcfa",
      textColor: "#28312d",
    });
  });

  it("widens the previous default reading width without touching custom widths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-settings-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        appearanceRevision: 3,
        contentWidth: 1120,
      }),
      "utf8",
    );

    const store = new SettingsStore(settingsPath);
    const settings = await store.load();

    expect(settings).toMatchObject({
      appearanceRevision: 4,
      contentWidth: 1200,
    });
  });
});
