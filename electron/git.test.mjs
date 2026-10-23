import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const {
  classifyGitChange,
  GitService,
  decodeGitStatus,
  normalizeRelativeGitPath,
  toIgnorePattern,
} = require("./git.cjs");

async function git(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function createRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spacenotes-git-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "SpaceNotes Test"]);
  await git(root, ["config", "user.email", "spacenotes@example.test"]);
  await fs.writeFile(path.join(root, "README.md"), "initial\n", "utf8");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);

  const service = new GitService({
    getVaultPath: () => root,
    resolveInsideVault: (relativePath) => path.resolve(root, relativePath),
  });
  return { root, service };
}

describe("GitService commit safety", () => {
  it("refuses to commit staged files that are not selected in the UI", async () => {
    const service = new GitService({
      getVaultPath: () => path.resolve("."),
    });
    service.status = async () => ({
      changes: [
        {
          path: "notes/selected.md",
          staged: false,
        },
        {
          path: "notes/already-staged.md",
          staged: true,
        },
      ],
    });

    await expect(service.commit("test", ["notes/selected.md"])).rejects.toThrow(
      "存在未勾选但已暂存的文件",
    );
  });

  it("refuses to commit selected files that still contain conflicts", async () => {
    const service = new GitService({
      getVaultPath: () => path.resolve("."),
    });
    service.status = async () => ({
      changes: [
        {
          path: "notes/conflict.md",
          staged: false,
          conflict: true,
        },
      ],
    });

    await expect(service.commit("test", ["notes/conflict.md"])).rejects.toThrow(
      "存在尚未解决的冲突文件",
    );
  });
});

describe("Git status labels", () => {
  it("maps porcelain status codes to Chinese labels", () => {
    expect(decodeGitStatus("M")).toBe("已修改");
    expect(decodeGitStatus("?")).toBe("未跟踪");
    expect(decodeGitStatus("U")).toBe("存在冲突");
  });

  it("classifies changed files for IntelliJ-style color markers", () => {
    expect(classifyGitChange(" ", "M")).toMatchObject({
      code: "M",
      kind: "modified",
    });
    expect(classifyGitChange("A", " ")).toMatchObject({
      code: "A",
      kind: "added",
    });
    expect(classifyGitChange("D", " ")).toMatchObject({
      code: "D",
      kind: "deleted",
    });
    expect(classifyGitChange("R", " ")).toMatchObject({
      code: "R",
      kind: "renamed",
    });
    expect(classifyGitChange("?", "?")).toMatchObject({
      code: "?",
      kind: "untracked",
    });
    expect(classifyGitChange("A", "A")).toMatchObject({
      code: "U",
      kind: "conflict",
    });
  });
});

describe("Git paths and ignore patterns", () => {
  it("normalizes repository-relative paths and creates exact Git patterns", () => {
    expect(normalizeRelativeGitPath(".\\notes\\today.md")).toBe(
      "notes/today.md",
    );
    expect(toIgnorePattern("private", true)).toBe("/private/");
    expect(toIgnorePattern("#draft.md", false)).toBe("/#draft.md");
    expect(toIgnorePattern("notes/[draft]*.md", false)).toBe(
      "/notes/\\[draft\\]\\*.md",
    );
    expect(() => normalizeRelativeGitPath("../outside.md")).toThrow(
      "Git 路径超出当前仓库",
    );
  });

  it("adds and removes ignore rules for a directory", async () => {
    const { root, service } = await createRepository();
    try {
      await fs.mkdir(path.join(root, "private"));
      await fs.writeFile(
        path.join(root, "private", "secret.md"),
        "secret\n",
        "utf8",
      );

      const added = await service.addIgnore({
        path: "private",
        isDirectory: true,
        scope: "project",
      });
      expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe(
        "/private/\n",
      );
      expect(added.status.ignoredCount).toBe(1);
      expect(added.state.rules).toContainEqual(
        expect.objectContaining({
          scope: "project",
          pattern: "/private/",
        }),
      );

      const removed = await service.removeIgnore("project", 1);
      expect(removed.state.rules).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);

  it("stops tracking an already tracked file while preserving it locally", async () => {
    const { root, service } = await createRepository();
    try {
      await fs.writeFile(path.join(root, "tracked.md"), "tracked\n", "utf8");
      await git(root, ["add", "tracked.md"]);
      await git(root, ["commit", "-m", "add tracked file"]);

      const result = await service.addIgnore({
        path: "tracked.md",
        isDirectory: false,
        scope: "local",
      });
      expect(result.output).toContain("停止跟踪");
      expect(await fs.readFile(path.join(root, "tracked.md"), "utf8")).toBe(
        "tracked\n",
      );
      expect(await git(root, ["ls-files", "--", "tracked.md"])).toBe("");
      expect(
        await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf8"),
      ).toContain("tracked.md");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20000);

  it("hides ignored tracked folder removals from user changes", async () => {
    const { root, service } = await createRepository();
    try {
      const ignoredFolder = path.join(root, ".obsidian");
      const cachedFile = path.join(ignoredFolder, "工作区", "缓存.json");
      await fs.mkdir(path.dirname(cachedFile), { recursive: true });
      await fs.writeFile(cachedFile, "{}\n", "utf8");
      await git(root, ["add", ".obsidian"]);
      await git(root, ["commit", "-m", "track Obsidian settings"]);

      const result = await service.addIgnore({
        path: ".obsidian",
        isDirectory: true,
        scope: "project",
      });

      expect(result.status.changes).not.toContainEqual(
        expect.objectContaining({ path: ".obsidian/工作区/缓存.json" }),
      );
      expect(result.status.ignoredTrackedChanges).toContainEqual(
        expect.objectContaining({
          path: ".obsidian/工作区/缓存.json",
          ignoredByRule: true,
          ignoredRule: expect.objectContaining({ pattern: "/.obsidian/" }),
        }),
      );
      expect(result.status.ignoredTrackedCount).toBe(1);

      const committed = await service.commit(
        "chore: stop tracking ignored paths",
        [],
      );
      expect(committed.status.ignoredTrackedCount).toBe(0);
      expect(
        await git(root, ["ls-tree", "-r", "--name-only", "HEAD"]),
      ).not.toContain(".obsidian/");
      expect(await fs.readFile(cachedFile, "utf8")).toBe("{}\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20000);
});

describe("Git local workflow", () => {
  it("resolves repository paths when Windows casing differs", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const { root, service } = await createRepository();
    try {
      expect(
        await service.repositoryRelativePath(root.toUpperCase(), "README.md"),
      ).toBe("README.md");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("discards staged and unstaged changes for a tracked file", async () => {
    const { root, service } = await createRepository();
    try {
      await fs.writeFile(
        path.join(root, "README.md"),
        "changed\n",
        "utf8",
      );
      await git(root, ["add", "README.md"]);
      await fs.writeFile(
        path.join(root, "README.md"),
        "changed again\n",
        "utf8",
      );

      const status = await service.discard(["README.md"]);
      expect(status.changes).toHaveLength(0);
      expect(
        (await fs.readFile(path.join(root, "README.md"), "utf8")).replace(
          /\r\n/g,
          "\n",
        ),
      ).toBe("initial\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates and switches local branches", async () => {
    const { root, service } = await createRepository();
    try {
      const created = await service.createBranch("notes/test");
      expect(created.status.branch).toBe("notes/test");
      expect(created.branches).toContainEqual(
        expect.objectContaining({ name: "notes/test", current: true }),
      );

      const switched = await service.checkoutBranch("main");
      expect(switched.status.branch).toBe("main");
      expect(switched.branches).toContainEqual(
        expect.objectContaining({ name: "main", current: true }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
