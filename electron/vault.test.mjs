import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { SettingsStore, VaultService } = require("./vault.cjs");
const { createNativeFileOperations } = require("./file-operations.cjs");

const temporaryDirectories = [];
const nativeFileOperations =
  process.platform === "darwin"
    ? createNativeFileOperations(
        path.resolve("build/macos/space-notes-fs"),
      )
    : undefined;

afterEach(async () => {
  vi.restoreAllMocks();
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
  const vault = new VaultService(settings, () => {}, {
    ...(nativeFileOperations ? { fileOperations: nativeFileOperations } : {}),
    ...platformActions,
  });
  await vault.open(root);
  return { root, vault, fileOperations: nativeFileOperations };
}

describe("VaultService platform actions", () => {
  it("delegates a validated trash request and updates the index", async () => {
    const trashItem = vi.fn(async () => {});
    const { root, vault } = await createFixture({ trashItem });
    try {
      await vault.trashNote("notes/Java Base/example.md");

      expect(trashItem).toHaveBeenCalledWith(
        path.join(vault.getVaultPath(), "notes", "Java Base", "example.md"),
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

describe("VaultService path containment", () => {
  it("creates nested notes through fd-relative parent creation", async () => {
    const { vault } = await createFixture();
    try {
      await expect(
        vault.createNote("notes/archive/deep", "New note"),
      ).resolves.toEqual({
        path: "notes/archive/deep/New note.md",
        content: "# New note\n\n",
      });
      await expect(
        vault.readNote("notes/archive/deep/New note.md"),
      ).resolves.toEqual({
        path: "notes/archive/deep/New note.md",
        content: "# New note\n\n",
      });
    } finally {
      await vault.closeWatcher();
    }
  });

  it("creates notes at the vault root with the native helper", async () => {
    const { vault } = await createFixture();
    try {
      await expect(vault.createNote("", "Root note")).resolves.toEqual({
        path: "Root note.md",
        content: "# Root note\n\n",
      });
      await expect(
        vault.createNote(undefined, "Another root"),
      ).resolves.toEqual({
        path: "Another root.md",
        content: "# Another root\n\n",
      });
    } finally {
      await vault.closeWatcher();
    }
  });

  it.runIf(process.platform !== "win32")(
    "rejects reading and writing through a file symlink outside the vault",
    async () => {
    const { root, vault } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const outsideNote = path.join(outsideRoot, "outside.md");
    await fs.writeFile(outsideNote, "# Outside\n", "utf8");
    await fs.symlink(outsideNote, path.join(root, "linked.md"));

    try {
      await expect(vault.readNote("linked.md")).rejects.toThrow(
        "文件路径超出当前笔记库",
      );
      await expect(vault.writeNote("linked.md", "# Changed\n")).rejects.toThrow(
        "文件路径超出当前笔记库",
      );
      await expect(fs.readFile(outsideNote, "utf8")).resolves.toBe(
        "# Outside\n",
      );
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects writing through a dangling symlink without creating its target",
    async () => {
    const { root, vault } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const outsideNote = path.join(outsideRoot, "created-outside.md");
    await fs.symlink(outsideNote, path.join(root, "dangling.md"));

    try {
      await expect(
        vault.writeNote("dangling.md", "# Escaped\n"),
      ).rejects.toThrow("文件路径超出当前笔记库");
      await expect(fs.access(outsideNote)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects creating notes below a directory symlink outside the vault",
    async () => {
    const { root, vault } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    await fs.symlink(outsideRoot, path.join(root, "linked-directory"), "dir");

    try {
      await expect(
        vault.createNote("linked-directory", "escaped"),
      ).rejects.toThrow("文件路径超出当前笔记库");
      await expect(
        fs.access(path.join(outsideRoot, "escaped.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform !== "win32")(
    "renames and trashes symlink entries without following their targets",
    async () => {
    const trashedPaths = [];
    const trashItem = vi.fn(async (absolutePath) => {
      trashedPaths.push(absolutePath);
      await fs.unlink(absolutePath);
    });
    const { root, vault } = await createFixture({ trashItem });
    const targetPath = path.join(root, "target.md");
    const linkPath = path.join(root, "link.md");
    await fs.writeFile(targetPath, "# Target\n", "utf8");
    await fs.symlink("target.md", linkPath);

    try {
      await expect(vault.renameNote("link.md", "link")).resolves.toEqual({
        path: "link.md",
      });
      await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("# Target\n");

      await expect(vault.renameNote("link.md", "renamed")).resolves.toEqual({
        path: "renamed.md",
      });
      await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("# Target\n");
      expect((await fs.lstat(path.join(root, "renamed.md"))).isSymbolicLink()).toBe(
        true,
      );
      expect(await fs.readlink(path.join(root, "renamed.md"))).toBe("target.md");

      await vault.trashNote("renamed.md");
      expect(trashItem).toHaveBeenCalledWith(
        path.join(vault.getVaultPath(), "renamed.md"),
      );
      expect(trashedPaths).toEqual([
        path.join(vault.getVaultPath(), "renamed.md"),
      ]);
      await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("# Target\n");
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects renaming and trashing file symlinks outside the vault",
    async () => {
    const trashItem = vi.fn(async () => {});
    const { root, vault } = await createFixture({ trashItem });
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const outsideNote = path.join(outsideRoot, "outside.md");
    await fs.writeFile(outsideNote, "# Outside\n", "utf8");
    await fs.symlink(outsideNote, path.join(root, "linked.md"));

    try {
      await expect(vault.renameNote("linked.md", "renamed")).rejects.toThrow(
        "文件路径超出当前笔记库",
      );
      await expect(vault.trashNote("linked.md")).rejects.toThrow(
        "文件路径超出当前笔记库",
      );
      expect(trashItem).not.toHaveBeenCalled();
      await expect(fs.readFile(outsideNote, "utf8")).resolves.toBe(
        "# Outside\n",
      );
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform === "darwin")(
    "rejects a directory symlink swapped in after read validation",
    async () => {
    const { root, vault, fileOperations } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const insideDirectory = path.join(root, "race");
    const outsideDirectory = path.join(outsideRoot, "race");
    const outsideNote = path.join(outsideDirectory, "note.md");
    await fs.mkdir(insideDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.writeFile(outsideNote, "OUTSIDE_SECRET\n", "utf8");
    await fs.writeFile(path.join(insideDirectory, "note.md"), "# Inside\n");
    const originalRead = fileOperations.read;
    vi.spyOn(fileOperations, "read").mockImplementationOnce(async (...args) => {
      await fs.rename(insideDirectory, `${insideDirectory}-inside`);
      await fs.symlink(outsideDirectory, insideDirectory, "dir");
      return originalRead(...args);
    });

    try {
      await expect(vault.readNote("race/note.md")).rejects.toThrow();
      await expect(fs.readFile(outsideNote, "utf8")).resolves.toBe(
        "OUTSIDE_SECRET\n",
      );
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform === "darwin")(
    "rejects a directory symlink swapped in before write side effects",
    async () => {
    const { root, vault, fileOperations } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const insideDirectory = path.join(root, "race");
    const outsideDirectory = path.join(outsideRoot, "race");
    const outsideNote = path.join(outsideDirectory, "note.md");
    await fs.mkdir(insideDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.writeFile(outsideNote, "OUTSIDE_SECRET\n", "utf8");
    await fs.writeFile(path.join(insideDirectory, "note.md"), "# Inside\n");
    const originalWrite = fileOperations.write;
    vi.spyOn(fileOperations, "write").mockImplementationOnce(
      async (...args) => {
        await fs.rename(insideDirectory, `${insideDirectory}-inside`);
        await fs.symlink(outsideDirectory, insideDirectory, "dir");
        return originalWrite(...args);
      },
    );

    try {
      await expect(
        vault.writeNote("race/note.md", "# Escaped\n"),
      ).rejects.toThrow();
      await expect(fs.readFile(outsideNote, "utf8")).resolves.toBe(
        "OUTSIDE_SECRET\n",
      );
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform === "darwin")(
    "rejects a directory symlink swapped in before rename side effects",
    async () => {
    const { root, vault, fileOperations } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const insideDirectory = path.join(root, "race");
    const outsideDirectory = path.join(outsideRoot, "race");
    const outsideNote = path.join(outsideDirectory, "note.md");
    await fs.mkdir(insideDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.writeFile(outsideNote, "# Outside\n", "utf8");
    await fs.writeFile(path.join(insideDirectory, "note.md"), "# Inside\n");
    const originalRename = fileOperations.rename;
    vi.spyOn(fileOperations, "rename").mockImplementationOnce(
      async (...args) => {
        await fs.rename(insideDirectory, `${insideDirectory}-inside`);
        await fs.symlink(outsideDirectory, insideDirectory, "dir");
        return originalRename(...args);
      },
    );

    try {
      await expect(
        vault.renameNote("race/note.md", "renamed"),
      ).rejects.toThrow();
      await expect(fs.readFile(outsideNote, "utf8")).resolves.toBe(
        "# Outside\n",
      );
      await expect(
        fs.access(path.join(outsideDirectory, "renamed.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await vault.closeWatcher();
    }
    },
  );

  it.runIf(process.platform === "darwin")(
    "rejects a directory symlink swapped in before create-note side effects",
    async () => {
    const { root, vault, fileOperations } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const insideDirectory = path.join(root, "race");
    const outsideDirectory = path.join(outsideRoot, "race");
    const outsideNestedDirectory = path.join(outsideDirectory, "nested");
    await fs.mkdir(insideDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    const originalMkdir = fileOperations.mkdir;
    vi.spyOn(fileOperations, "mkdir").mockImplementationOnce(
      async (...args) => {
        await fs.rename(insideDirectory, `${insideDirectory}-inside`);
        await fs.symlink(outsideDirectory, insideDirectory, "dir");
        return originalMkdir(...args);
      },
    );

    try {
      await expect(
        vault.createNote("race/nested", "created"),
      ).rejects.toThrow();
      await expect(fs.access(outsideNestedDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await vault.closeWatcher();
    }
    },
  );
});

describe("VaultService overwrite protection", () => {
  it.runIf(process.platform === "darwin")(
    "never truncates an existing file through an exclusive helper write",
    async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "space-notes-exclusive-write-"),
      );
      temporaryDirectories.push(root);
      const existing = path.join(root, "existing.md");
      await fs.writeFile(existing, "# Existing\n", "utf8");

      await expect(
        nativeFileOperations.write(
          root,
          "existing.md",
          "# Replacement\n",
          "exclusive",
        ),
      ).rejects.toThrow();
      await expect(fs.readFile(existing, "utf8")).resolves.toBe("# Existing\n");
    },
  );

  it.runIf(process.platform === "darwin")(
    "never replaces an existing destination through the rename helper",
    async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "space-notes-exclusive-rename-"),
      );
      temporaryDirectories.push(root);
      await fs.writeFile(path.join(root, "source.md"), "SOURCE\n", "utf8");
      await fs.writeFile(
        path.join(root, "destination.md"),
        "DESTINATION\n",
        "utf8",
      );

      await expect(
        nativeFileOperations.rename(
          root,
          "source.md",
          "destination.md",
        ),
      ).rejects.toThrow();
      await expect(
        fs.readFile(path.join(root, "source.md"), "utf8"),
      ).resolves.toBe("SOURCE\n");
      await expect(
        fs.readFile(path.join(root, "destination.md"), "utf8"),
      ).resolves.toBe("DESTINATION\n");
    },
  );

  it("uses a suffix when a note exists on disk but is missing from the index", async () => {
    const { root, vault } = await createFixture();
    await fs.writeFile(path.join(root, "Disk only.md"), "# Existing\n", "utf8");
    try {
      await expect(vault.createNote("", "Disk only")).resolves.toEqual({
        path: "Disk only 2.md",
        content: "# Disk only\n\n",
      });
      await expect(fs.readFile(path.join(root, "Disk only.md"), "utf8")).resolves.toBe(
        "# Existing\n",
      );
    } finally {
      await vault.closeWatcher();
    }
  });

  it("rejects renaming a note over another indexed note", async () => {
    const { root, vault } = await createFixture();
    try {
      const source = await vault.createNote("", "Source");
      await vault.writeNote(source.path, "SOURCE\n");
      const destination = await vault.createNote("", "Destination");
      await vault.writeNote(destination.path, "DESTINATION\n");

      await expect(
        vault.renameNote(source.path, "Destination"),
      ).rejects.toThrow("同名笔记已存在");
      await expect(fs.readFile(path.join(root, source.path), "utf8")).resolves.toBe(
        "SOURCE\n",
      );
      await expect(
        fs.readFile(path.join(root, destination.path), "utf8"),
      ).resolves.toBe("DESTINATION\n");
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
        await fs.realpath(
          path.join(
            vault.getVaultPath(),
            "notes",
            "Java Base",
            "images",
            "local.png",
          ),
        ),
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
      expect(resolved).toBe(
        await fs.realpath(path.join(vault.getVaultPath(), "images", "root.png")),
      );
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

  it.runIf(process.platform !== "win32")(
    "rejects attachments that escape through a symbolic link",
    async () => {
    const { root, vault } = await createFixture();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-outside-"),
    );
    temporaryDirectories.push(outsideRoot);
    const outsideAsset = path.join(outsideRoot, "secret.png");
    await fs.writeFile(outsideAsset, "secret", "utf8");
    await fs.symlink(
      outsideAsset,
      path.join(root, "images", "linked.png"),
    );

    try {
      await expect(
        vault.resolveAsset("images/linked.png", "notes/example.md"),
      ).rejects.toThrow("图片路径超出当前笔记库");
    } finally {
      await vault.closeWatcher();
    }
    },
  );
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
