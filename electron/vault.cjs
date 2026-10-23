const fs = require("node:fs/promises");
const path = require("node:path");
const chokidar = require("chokidar");

const DEFAULT_SETTINGS = {
  appearanceRevision: 4,
  themeMode: "light",
  accent: "#4b708b",
  background: "#ffffff",
  textColor: "#333333",
  editorFontSize: 15,
  editorLineHeight: 1.8,
  contentWidth: 1200,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  showHiddenFiles: false,
  recentVault: "",
};

const ALWAYS_SKIPPED_DIRECTORIES = new Set([".git"]);
const NON_RECURSIVE_DIRECTORIES = new Set([
  ".obsidian",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "release",
]);
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

/**
 * Persists user-facing preferences outside the note vault so switching between
 * Markdown editors never rewrites the user's existing workspace.
 */
class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const saved = JSON.parse(content);
      this.settings = { ...DEFAULT_SETTINGS, ...saved };

      // Revision 2 tightens the default writing layout without overwriting a
      // user's explicitly customized widths or line height.
      if (Number(saved.appearanceRevision || 0) < 2) {
        if (this.settings.contentWidth === 860) {
          this.settings.contentWidth = 1120;
        }
        if (this.settings.sidebarWidth === 284) {
          this.settings.sidebarWidth = 320;
        }
        if (this.settings.editorLineHeight === 1.9) {
          this.settings.editorLineHeight = 1.8;
        }
        this.settings.appearanceRevision = 2;
      }

      // Revision 3 replaces the original purple default with the neutral,
      // Typora-like document palette. Custom color schemes stay untouched.
      if (Number(saved.appearanceRevision || 0) < 3) {
        const usesOriginalPalette =
          saved.background === "#ffffff" &&
          saved.textColor === "#30343a" &&
          saved.accent === "#6c59c6";
        if (usesOriginalPalette) {
          this.settings.background = "#ffffff";
          this.settings.textColor = "#333333";
          this.settings.accent = "#4b708b";
        }
        this.settings.appearanceRevision = 3;
      }

      // Revision 4 matches Obsidian's wider writing canvas while preserving
      // any reading width that the user has already customized.
      if (Number(saved.appearanceRevision || 0) < 4) {
        if (this.settings.contentWidth === 1120) {
          this.settings.contentWidth = 1200;
        }
        this.settings.appearanceRevision = 4;
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  get() {
    return { ...this.settings };
  }

  async save(updates) {
    this.settings = { ...this.settings, ...updates };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(this.settings, null, 2),
      "utf8",
    );
    return this.get();
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function isHiddenRelativePath(value) {
  return toPosixPath(value)
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function normalizeLinkTarget(value) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .split("#")[0]
    .toLowerCase();
}

function extractFrontmatterTitle(content, fallback) {
  if (!content.startsWith("---")) {
    return fallback;
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return fallback;
  }

  const frontmatter = content.slice(3, end);
  const titleMatch = frontmatter.match(/^\s*title\s*:\s*["']?(.+?)["']?\s*$/im);
  return titleMatch?.[1]?.trim() || fallback;
}

function extractHeadings(content) {
  const headings = [];
  let insideFence = false;
  let fenceMarker = "";

  content.split(/\r?\n/).forEach((line, index) => {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!insideFence) {
        insideFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        insideFence = false;
      }
      return;
    }

    if (insideFence) {
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      headings.push({
        level: heading[1].length,
        text: heading[2].trim(),
        line: index + 1,
      });
    }
  });

  return headings;
}

function extractLinks(content) {
  const links = new Set();
  const wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const markdownPattern = /\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]+)?\)/gi;

  for (const match of content.matchAll(wikiPattern)) {
    links.add(normalizeLinkTarget(match[1]));
  }
  for (const match of content.matchAll(markdownPattern)) {
    links.add(normalizeLinkTarget(match[1]));
  }
  return links;
}

function extractTags(content) {
  const tags = new Set();
  const inlinePattern = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
  for (const match of content.matchAll(inlinePattern)) {
    const tag = match[2].trim();
    if (tag && !/^\d+$/.test(tag)) {
      tags.add(tag);
    }
  }

  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const tagsLevel = frontmatter[1].match(/^\s*tags\s*:\s*(.+)$/im);
    if (tagsLevel) {
      tagsLevel[1]
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .forEach((tag) => tags.add(tag.replace(/^#/, "")));
    }
  }
  return [...tags];
}

function searchText(haystack, query, mode) {
  const normalizedHaystack = haystack.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase().trim();
  if (!normalizedQuery) {
    return false;
  }

  if (mode === "exact") {
    return normalizedHaystack.includes(normalizedQuery);
  }

  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalizedHaystack.includes(token));
}

function createSearchSnippet(content, query) {
  const normalizedQuery = query.toLocaleLowerCase().split(/\s+/)[0] || "";
  const lower = content.toLocaleLowerCase();
  const index = normalizedQuery ? lower.indexOf(normalizedQuery) : -1;

  if (index === -1) {
    return content.replace(/\s+/g, " ").slice(0, 150);
  }

  const start = Math.max(0, index - 55);
  const end = Math.min(content.length, index + normalizedQuery.length + 100);
  return `${start > 0 ? "..." : ""}${content.slice(start, end).replace(/\s+/g, " ")}${end < content.length ? "..." : ""}`;
}

/**
 * Owns the Markdown index and is the only process allowed to touch vault files.
 * Renderer requests never receive unrestricted filesystem access.
 */
class VaultService {
  constructor(settingsStore, onVaultChanged, platformActions = {}) {
    this.settingsStore = settingsStore;
    this.onVaultChanged = onVaultChanged;
    this.trashItem = platformActions.trashItem || null;
    this.vaultPath = "";
    this.documents = new Map();
    this.directories = new Set();
    this.assets = new Map();
    this.watcher = null;
    this.refreshTimer = null;
  }

  async open(rootPath) {
    const resolved = path.resolve(rootPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error("选择的路径不是文件夹。");
    }

    await this.closeWatcher();
    this.vaultPath = resolved;
    await this.rebuildIndex();
    await this.startWatcher();
    await this.settingsStore.save({ recentVault: resolved });
    return this.snapshot("opened");
  }

  async restore() {
    const recentVault = this.settingsStore.get().recentVault;
    if (!recentVault) {
      return null;
    }

    try {
      return await this.open(recentVault);
    } catch {
      await this.settingsStore.save({ recentVault: "" });
      return null;
    }
  }

  getVaultPath() {
    return this.vaultPath;
  }

  assertVaultReady() {
    if (!this.vaultPath) {
      throw new Error("请先打开一个笔记库。");
    }
  }

  resolveInsideVault(relativePath) {
    this.assertVaultReady();
    const resolved = path.resolve(this.vaultPath, relativePath);
    const rootWithSeparator = `${path.resolve(this.vaultPath)}${path.sep}`;
    if (resolved !== path.resolve(this.vaultPath) && !resolved.startsWith(rootWithSeparator)) {
      throw new Error("文件路径超出当前笔记库。");
    }
    return resolved;
  }

  async rebuildIndex() {
    const nextDocuments = new Map();
    const nextAssets = new Map();
    const nextDirectories = new Set();
    await this.walkDirectory(
      this.vaultPath,
      nextDocuments,
      nextAssets,
      nextDirectories,
    );
    this.documents = nextDocuments;
    this.directories = nextDirectories;
    this.assets = nextAssets;
  }

  async refreshIndex() {
    await this.rebuildIndex();
    const next = this.snapshot("visibility-change");
    this.onVaultChanged?.(next);
    return next;
  }

  async walkDirectory(
    currentDirectory,
    target,
    assetTarget,
    directoryTarget,
  ) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    const showHiddenFiles = Boolean(
      this.settingsStore.get().showHiddenFiles,
    );

    for (const entry of entries) {
      if (ALWAYS_SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (!showHiddenFiles && entry.name.startsWith(".")) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        const relativeDirectory = toPosixPath(
          path.relative(this.vaultPath, absolutePath),
        );
        directoryTarget.add(relativeDirectory);

        // Configuration and dependency folders stay visible for Git actions,
        // but their internals are not useful in the note tree.
        if (!NON_RECURSIVE_DIRECTORIES.has(entry.name)) {
          await this.walkDirectory(
            absolutePath,
            target,
            assetTarget,
            directoryTarget,
          );
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const relativePath = toPosixPath(path.relative(this.vaultPath, absolutePath));
      if (IMAGE_EXTENSIONS.has(extension)) {
        const assetKey = entry.name.toLocaleLowerCase();
        const matches = assetTarget.get(assetKey) || [];
        matches.push(relativePath);
        assetTarget.set(assetKey, matches);
        continue;
      }

      if (extension !== ".md") {
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        const content = await fs.readFile(absolutePath, "utf8");
        target.set(relativePath, this.createIndexRecord(relativePath, content, stat));
      } catch {
        // An editor may be writing a file while indexing; it will be retried on the next event.
      }
    }
  }

  async resolveAsset(target, notePath = "") {
    this.assertVaultReady();
    const normalizedTarget = String(target || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    if (!normalizedTarget || /^[a-z]:\//i.test(normalizedTarget)) {
      throw new Error("图片路径无效。");
    }

    const candidates = [normalizedTarget];
    if (notePath) {
      candidates.push(
        path.posix.join(path.posix.dirname(notePath), normalizedTarget),
      );
    }

    // Existing Markdown vaults often contain both note-relative and vault-relative paths.
    for (const candidate of candidates) {
      try {
        const absolutePath = this.resolveInsideVault(candidate);
        const stat = await fs.stat(absolutePath);
        if (stat.isFile()) {
          return absolutePath;
        }
      } catch {
        // Try the next common Markdown path convention.
      }
    }

    // Older notes may contain stale relative segments but a unique attachment
    // filename. Falling back by filename keeps those images readable.
    const assetKey = path.posix.basename(normalizedTarget).toLocaleLowerCase();
    for (const relativePath of this.assets.get(assetKey) || []) {
      const absolutePath = this.resolveInsideVault(relativePath);
      try {
        if ((await fs.stat(absolutePath)).isFile()) {
          return absolutePath;
        }
      } catch {
        // Ignore stale index entries; the watcher will refresh the asset list.
      }
    }

    throw new Error("图片不存在。");
  }

  createIndexRecord(relativePath, content, stat) {
    const fileName = path.basename(relativePath, ".md");
    return {
      path: relativePath,
      title: extractFrontmatterTitle(content, fileName),
      content,
      modifiedAt: stat.mtimeMs,
      size: stat.size,
      headings: extractHeadings(content),
      tags: extractTags(content),
      links: [...extractLinks(content)],
    };
  }

  async startWatcher() {
    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: (watchedPath) => {
        const relative = toPosixPath(path.relative(this.vaultPath, watchedPath));
        const segments = relative.split("/").filter(Boolean);
        if (segments.includes(".git")) {
          return true;
        }

        // Configuration and dependency folders remain visible themselves,
        // while their internals do not cause repeated note index rebuilds.
        return segments.some(
          (segment, index) =>
            index < segments.length - 1 &&
            NON_RECURSIVE_DIRECTORIES.has(segment),
        );
      },
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 180,
        pollInterval: 60,
      },
    });

    const schedule = async (relativePath) => {
      if (
        relativePath &&
        isHiddenRelativePath(relativePath) &&
        !this.settingsStore.get().showHiddenFiles
      ) {
        return;
      }

      if (relativePath && path.extname(relativePath).toLowerCase() === ".md") {
        const normalized = toPosixPath(relativePath);
        const absolute = this.resolveInsideVault(normalized);
        try {
          const stat = await fs.stat(absolute);
          const content = await fs.readFile(absolute, "utf8");
          this.documents.set(
            normalized,
            this.createIndexRecord(normalized, content, stat),
          );
        } catch {
          this.documents.delete(normalized);
        }
      } else {
        await this.rebuildIndex();
      }

      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => {
        this.onVaultChanged?.(this.snapshot("external-change"));
      }, 120);
    };

    this.watcher.on("add", (absolute) => {
      schedule(toPosixPath(path.relative(this.vaultPath, absolute)));
    });
    this.watcher.on("change", (absolute) => {
      schedule(toPosixPath(path.relative(this.vaultPath, absolute)));
    });
    this.watcher.on("unlink", (absolute) => {
      schedule(toPosixPath(path.relative(this.vaultPath, absolute)));
    });
    this.watcher.on("addDir", () => schedule(""));
    this.watcher.on("unlinkDir", () => schedule(""));
  }

  async closeWatcher() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  snapshot(reason = "updated") {
    if (!this.vaultPath) {
      return null;
    }
    return {
      path: this.vaultPath,
      name: path.basename(this.vaultPath),
      reason,
      files: [...this.documents.values()]
        .map(({ content, headings, links, ...file }) => file)
        .sort((left, right) =>
          left.path.localeCompare(right.path, "zh-CN", { numeric: true }),
        ),
      directories: [...this.directories].sort((left, right) =>
        left.localeCompare(right, "zh-CN", { numeric: true }),
      ),
    };
  }

  async readNote(relativePath) {
    const absolute = this.resolveInsideVault(relativePath);
    const content = await fs.readFile(absolute, "utf8");
    return {
      path: relativePath,
      content,
    };
  }

  async writeNote(relativePath, content) {
    const absolute = this.resolveInsideVault(relativePath);
    await fs.writeFile(absolute, content, "utf8");
    const stat = await fs.stat(absolute);
    this.documents.set(
      relativePath,
      this.createIndexRecord(relativePath, content, stat),
    );
    this.onVaultChanged?.(this.snapshot("saved"));
    return { modifiedAt: stat.mtimeMs };
  }

  async createNote(parentPath, title) {
    const safeTitle = title.trim().replace(/[<>:"/\\|?*]/g, "-");
    if (!safeTitle) {
      throw new Error("笔记名称不能为空。");
    }

    const prefix = parentPath ? `${parentPath.replace(/\/$/, "")}/` : "";
    let relativePath = `${prefix}${safeTitle}.md`;
    let suffix = 2;
    while (this.documents.has(relativePath)) {
      relativePath = `${prefix}${safeTitle} ${suffix}.md`;
      suffix += 1;
    }

    const absolute = this.resolveInsideVault(relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const content = `# ${safeTitle}\n\n`;
    await fs.writeFile(absolute, content, {
      encoding: "utf8",
      flag: "wx",
    });
    const stat = await fs.stat(absolute);
    this.documents.set(
      relativePath,
      this.createIndexRecord(relativePath, content, stat),
    );
    this.onVaultChanged?.(this.snapshot("created"));
    return { path: relativePath, content };
  }

  async trashNote(relativePath) {
    if (typeof this.trashItem !== "function") {
      throw new Error("当前宿主不支持将笔记移入废纸篓。");
    }
    const absolute = this.resolveInsideVault(relativePath);
    await this.trashItem(absolute);
    this.documents.delete(relativePath);
    this.onVaultChanged?.(this.snapshot("trashed"));
  }

  async renameNote(relativePath, nextTitle) {
    const safeTitle = nextTitle.trim().replace(/[<>:"/\\|?*]/g, "-");
    if (!safeTitle) {
      throw new Error("笔记名称不能为空。");
    }
    const source = this.resolveInsideVault(relativePath);
    const nextRelative = toPosixPath(
      path.join(path.dirname(relativePath), `${safeTitle}.md`),
    );
    const destination = this.resolveInsideVault(nextRelative);
    if (source === destination) {
      return { path: relativePath };
    }
    await fs.rename(source, destination);
    this.documents.delete(relativePath);
    const stat = await fs.stat(destination);
    const content = await fs.readFile(destination, "utf8");
    this.documents.set(
      nextRelative,
      this.createIndexRecord(nextRelative, content, stat),
    );
    this.onVaultChanged?.(this.snapshot("renamed"));
    return { path: nextRelative };
  }

  search(query, scope = "all", mode = "smart") {
    const results = [];
    for (const document of this.documents.values()) {
      if (!query.trim()) {
        continue;
      }

      const titleText = `${document.title} ${document.path}`;
      const titleMatches = searchText(titleText, query, mode);
      const contentMatches = searchText(document.content, query, mode);

      if (
        (scope === "title" && !titleMatches) ||
        (scope === "content" && !contentMatches) ||
        (scope === "all" && !titleMatches && !contentMatches)
      ) {
        continue;
      }

      results.push({
        path: document.path,
        title: document.title,
        matchKind:
          scope === "title"
            ? "title"
            : scope === "content"
              ? "content"
              : titleMatches
                ? "title"
                : "content",
        snippet: contentMatches
          ? createSearchSnippet(document.content, query)
          : document.path,
        modifiedAt: document.modifiedAt,
      });
    }

    return results
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, 100);
  }

  outline(relativePath) {
    return this.documents.get(relativePath)?.headings || [];
  }

  backlinks(relativePath) {
    const target = this.documents.get(relativePath);
    if (!target) {
      return [];
    }
    const targetNames = new Set([
      normalizeLinkTarget(relativePath),
      normalizeLinkTarget(target.title),
      normalizeLinkTarget(path.basename(relativePath, ".md")),
    ]);

    return [...this.documents.values()]
      .filter((document) => document.path !== relativePath)
      .filter((document) =>
        document.links.some((link) => targetNames.has(link)),
      )
      .map((document) => ({
        path: document.path,
        title: document.title,
        snippet: createSearchSnippet(document.content, target.title),
      }));
  }

  tags() {
    const counts = new Map();
    for (const document of this.documents.values()) {
      for (const tag of document.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  SettingsStore,
  VaultService,
  extractHeadings,
  extractLinks,
  extractTags,
  searchText,
};
