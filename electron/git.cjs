const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function sanitizedGitEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  delete sanitized.SPACENOTES_TOKEN;
  return sanitized;
}

function decodeGitStatus(code) {
  const labels = {
    M: "已修改",
    A: "已新增",
    D: "已删除",
    R: "已重命名",
    C: "已复制",
    U: "存在冲突",
    "?": "未跟踪",
    "!": "已忽略",
  };
  return labels[code] || "已修改";
}

const CONFLICT_STATUS_CODES = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

function normalizeRelativeGitPath(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("Git 路径无效。");
  }

  const normalized = path.posix
    .normalize(value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, ""))
    .replace(/\/+$/, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("Git 路径超出当前仓库。");
  }

  return normalized;
}

/**
 * Windows may refer to the same directory through an 8.3 short path, a long
 * path, or different casing. Canonicalize the nearest existing ancestor so Git
 * output and Electron paths can be compared without misreporting a repository
 * path as outside the workspace. Deleted files are supported because their
 * existing parent directory can still be canonicalized.
 */
async function canonicalPathForComparison(value) {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
      throw error;
    }
    const parent = path.dirname(resolved);
    if (parent === resolved) {
      return resolved;
    }
    return path.join(
      await canonicalPathForComparison(parent),
      path.basename(resolved),
    );
  }
}

function escapeGitIgnoreComponent(component) {
  return component.replace(/([\\*?[\]])/g, "\\$1");
}

/**
 * Anchor the selected path at the repository root so ignoring one file never
 * also hides same-named files in other folders. Git wildcard characters in a
 * real file name must stay literal.
 */
function toIgnorePattern(repoPath, isDirectory) {
  const pattern = normalizeRelativeGitPath(repoPath)
    .split("/")
    .map(escapeGitIgnoreComponent)
    .join("/");
  return `/${pattern}${isDirectory ? "/" : ""}`;
}

function ignoreFileSignature(pattern) {
  return pattern
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * Converts porcelain's two status columns into one visual code and semantic
 * kind. The UI uses the kind for IntelliJ-style colors while keeping the raw
 * columns available for stage/unstage decisions.
 */
function classifyGitChange(indexStatus, worktreeStatus) {
  const conflict = CONFLICT_STATUS_CODES.has(`${indexStatus}${worktreeStatus}`);
  const code = conflict
    ? "U"
    : indexStatus === "?"
      ? "?"
      : indexStatus !== " "
        ? indexStatus
        : worktreeStatus;

  let kind = "modified";
  if (conflict) {
    kind = "conflict";
  } else if (code === "?") {
    kind = "untracked";
  } else if (code === "!") {
    kind = "ignored";
  } else if (code === "A") {
    kind = "added";
  } else if (code === "D") {
    kind = "deleted";
  } else if (code === "R") {
    kind = "renamed";
  } else if (code === "C") {
    kind = "copied";
  }

  return {
    code,
    kind,
    label: decodeGitStatus(code),
  };
}

/**
 * A deliberately small Git facade. It shells out to the user's own Git client so
 * SSH agents, credential managers, proxies and hooks continue to work unchanged.
 */
class GitService {
  constructor(vaultService) {
    this.vaultService = vaultService;
  }

  get rootPath() {
    return this.vaultService.getVaultPath();
  }

  async run(args, options = {}) {
    if (!this.rootPath) {
      throw new Error("请先打开一个笔记库。");
    }

    try {
      const { env, ...commandOptions } = options;
      const result = await execFileAsync("git", args, {
        cwd: this.rootPath,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        ...commandOptions,
        env: sanitizedGitEnvironment(env),
      });
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        code: 0,
      };
    } catch (error) {
      if (typeof error.code === "number" && options.allowCodes?.includes(error.code)) {
        return {
          stdout: error.stdout || "",
          stderr: error.stderr || "",
          code: error.code,
        };
      }

      if (error.code === "ENOENT") {
        throw new Error("没有找到 Git。请先安装 Git 并重新启动应用。");
      }

      const detail = (error.stderr || error.stdout || error.message || "").trim();
      throw new Error(detail || "Git 命令执行失败。");
    }
  }

  /**
   * Streams NUL-delimited paths into Git without exposing them through a
   * shell. This is used for batch ignore checks where command-line length is
   * not predictable.
   */
  async runWithInput(args, input, options = {}) {
    if (!this.rootPath) {
      throw new Error("请先打开一个笔记库。");
    }

    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.rootPath,
        windowsHide: true,
        env: sanitizedGitEnvironment(options.env),
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (error.code === "ENOENT") {
          reject(new Error("没有找到 Git。请先安装 Git 并重新启动应用。"));
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        const exitCode = code ?? 1;
        if (exitCode === 0 || options.allowCodes?.includes(exitCode)) {
          resolve({ stdout, stderr, code: exitCode });
          return;
        }

        const detail = (stderr || stdout).trim();
        reject(new Error(detail || "Git 命令执行失败。"));
      });
      child.stdin.on("error", () => {
        // Git may close stdin early when it has no more matches.
      });
      child.stdin.end(input);
    });
  }

  async isRepository() {
    if (!this.rootPath) {
      return false;
    }
    const result = await this.run(
      ["rev-parse", "--is-inside-work-tree"],
      { allowCodes: [128] },
    );
    return result.code === 0 && result.stdout.trim() === "true";
  }

  async ignoredPathRules(paths) {
    if (!paths.length) {
      return new Map();
    }

    const result = await this.runWithInput(
      ["check-ignore", "-v", "-z", "--no-index", "--stdin"],
      `${paths.join("\0")}\0`,
      { allowCodes: [1] },
    );
    const rules = new Map();
    const fields = result.stdout.split("\0");

    for (let index = 0; index + 3 < fields.length; index += 4) {
      const source = fields[index];
      const line = Number(fields[index + 1]);
      const pattern = fields[index + 2];
      const path = fields[index + 3];
      if (path) {
        rules.set(path, { source, line, pattern });
      }
    }
    return rules;
  }

  async status() {
    if (!(await this.isRepository())) {
      return {
        repository: false,
        branch: "",
        upstream: "",
        ahead: 0,
        behind: 0,
        changes: [],
        ignoredTrackedChanges: [],
        ignoredTrackedCount: 0,
        ignoredCount: 0,
        remote: "",
      };
    }

    const branchResult = await this.run(["branch", "--show-current"]);
    let branch = branchResult.stdout.trim();
    if (!branch) {
      const headResult = await this.run(
        ["rev-parse", "--short", "HEAD"],
        { allowCodes: [128] },
      );
      branch = headResult.stdout.trim() || "未提交";
    }

    const upstreamResult = await this.run(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { allowCodes: [128] },
    );
    const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : "";

    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const countResult = await this.run(
        ["rev-list", "--left-right", "--count", `HEAD...${upstream}`],
        { allowCodes: [128] },
      );
      if (countResult.code === 0) {
        const [left, right] = countResult.stdout.trim().split(/\s+/).map(Number);
        ahead = Number.isFinite(left) ? left : 0;
        behind = Number.isFinite(right) ? right : 0;
      }
    }

    const remoteResult = await this.run(
      ["remote", "get-url", "origin"],
      { allowCodes: [2, 128] },
    );
    const statusResult = await this.run([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=matching",
    ]);
    const changes = [];
    let ignoredCount = 0;
    const records = statusResult.stdout.split("\0");

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 4) {
        continue;
      }

      const indexStatus = record[0];
      const worktreeStatus = record[1];
      const filePath = record.slice(3);

      if (indexStatus === "!" && worktreeStatus === "!") {
        ignoredCount += 1;
        continue;
      }

      // Rename and copy records contain the source path in the following NUL field.
      if (indexStatus === "R" || indexStatus === "C") {
        index += 1;
      }

      const classification = classifyGitChange(indexStatus, worktreeStatus);
      changes.push({
        path: filePath,
        indexStatus,
        worktreeStatus,
        ...classification,
        staged:
          classification.kind !== "conflict" &&
          indexStatus !== " " &&
          indexStatus !== "?" &&
          indexStatus !== "!",
        hasUnstaged:
          worktreeStatus !== " " &&
          worktreeStatus !== "?",
        untracked: indexStatus === "?",
        conflict: classification.kind === "conflict",
      });
    }

    // Staged deletions created by "ignore this tracked path" are maintenance
    // records, not user edits. Keep them out of the Changes list while still
    // allowing the next commit to include the repository removal.
    const ignoredRules = await this.ignoredPathRules(
      changes
        .filter(
          (change) =>
            change.kind === "deleted" && change.indexStatus === "D",
        )
        .map((change) => change.path),
    );
    const visibleChanges = [];
    const ignoredTrackedChanges = [];

    for (const change of changes) {
      const rule = ignoredRules.get(change.path);
      if (rule) {
        ignoredTrackedChanges.push({
          ...change,
          ignoredByRule: true,
          ignoredRule: rule,
        });
      } else {
        visibleChanges.push(change);
      }
    }

    return {
      repository: true,
      branch,
      upstream,
      ahead,
      behind,
      changes: visibleChanges,
      ignoredTrackedChanges,
      ignoredTrackedCount: ignoredTrackedChanges.length,
      ignoredCount,
      remote: remoteResult.stdout.trim(),
    };
  }

  async branches() {
    const result = await this.run([
      "for-each-ref",
      "--format=%(refname:short)%00%(HEAD)%00%(upstream:short)",
      "refs/heads",
    ]);

    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, head, upstream] = line.split("\0");
        return {
          name,
          current: head === "*",
          upstream: upstream || "",
        };
      });
  }

  async createBranch(name) {
    const branchName = name.trim();
    if (!branchName) {
      throw new Error("请输入分支名称。");
    }
    await this.run(["check-ref-format", "--branch", branchName]);
    const result = await this.run(["checkout", "-b", branchName]);
    return {
      output: result.stderr.trim() || result.stdout.trim() || "分支已创建。",
      status: await this.status(),
      branches: await this.branches(),
    };
  }

  async checkoutBranch(name) {
    const branchName = name.trim();
    if (!branchName) {
      throw new Error("请选择要切换的分支。");
    }
    const current = await this.status();
    if (current.branch === branchName) {
      return {
        output: "当前已经位于该分支。",
        status: current,
        branches: await this.branches(),
      };
    }
    const result = await this.run(["checkout", branchName]);
    return {
      output: result.stderr.trim() || result.stdout.trim() || "分支已切换。",
      status: await this.status(),
      branches: await this.branches(),
    };
  }

  async discard(paths) {
    if (!Array.isArray(paths) || !paths.length) {
      return this.status();
    }

    const current = await this.status();
    const repositoryRoot = await this.repositoryRoot();
    const safePaths = [];

    for (const rawPath of paths) {
      const change = current.changes.find((item) => item.path === rawPath);
      if (!change) {
        throw new Error(`找不到 Git 变更：${rawPath}`);
      }
      if (change.conflict) {
        throw new Error("冲突文件需要先在编辑器中处理。");
      }
      if (!["modified", "deleted"].includes(change.kind)) {
        throw new Error("当前只支持撤销已跟踪文件的修改或删除。");
      }
      safePaths.push(
        await this.repositoryRelativePath(repositoryRoot, rawPath),
      );
    }

    await this.run([
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ...safePaths,
    ]);
    return this.status();
  }

  async repositoryRoot() {
    const result = await this.run(["rev-parse", "--show-toplevel"]);
    return path.resolve(result.stdout.trim());
  }

  async repositoryRelativePath(repositoryRoot, relativePath) {
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      canonicalPathForComparison(repositoryRoot),
      canonicalPathForComparison(
        this.vaultService.resolveInsideVault(relativePath),
      ),
    ]);
    return normalizeRelativeGitPath(
      path.relative(canonicalRoot, canonicalTarget),
    );
  }

  async ignoreState() {
    const repositoryRoot = await this.repositoryRoot();
    const scopes = [
      {
        scope: "project",
        filePath: path.join(repositoryRoot, ".gitignore"),
        source: ".gitignore",
      },
      {
        scope: "local",
        filePath: path.join(repositoryRoot, ".git", "info", "exclude"),
        source: ".git/info/exclude",
      },
    ];
    const rules = [];

    for (const entry of scopes) {
      const content = await fs.readFile(entry.filePath, "utf8").catch(() => "");
      content.split(/\r?\n/).forEach((line, index) => {
        const pattern = line.trim();
        if (!pattern || pattern.startsWith("#")) {
          return;
        }
        rules.push({
          scope: entry.scope,
          source: entry.source,
          line: index + 1,
          pattern,
        });
      });
    }

    const current = await this.status();
    return {
      rules,
      ignoredCount: current.ignoredCount,
    };
  }

  async addIgnore({ path: relativePath, isDirectory, scope }) {
    if (!["project", "local"].includes(scope)) {
      throw new Error("未知的忽略规则范围。");
    }

    const repositoryRoot = await this.repositoryRoot();
    const repoPath = await this.repositoryRelativePath(
      repositoryRoot,
      relativePath,
    );
    const pattern = toIgnorePattern(repoPath, Boolean(isDirectory));
    const ignorePath =
      scope === "project"
        ? path.join(repositoryRoot, ".gitignore")
        : path.join(repositoryRoot, ".git", "info", "exclude");
    const existing = await fs.readFile(ignorePath, "utf8").catch(() => "");
    const duplicate = existing
      .split(/\r?\n/)
      .some(
        (line) =>
          !line.trim().startsWith("#") &&
          ignoreFileSignature(line) === ignoreFileSignature(pattern),
      );

    if (!duplicate) {
      await fs.mkdir(path.dirname(ignorePath), { recursive: true });
      const lineEnding = existing.includes("\r\n") ? "\r\n" : "\n";
      const separator =
        existing && !existing.endsWith("\n") ? lineEnding : "";
      await fs.writeFile(
        ignorePath,
        `${existing}${separator}${pattern}${lineEnding}`,
        "utf8",
      );
    }

    const trackedResult = await this.run([
      "ls-files",
      "--",
      repoPath,
    ]);
    let untracked = false;
    if (trackedResult.stdout.trim()) {
      await this.run([
        "rm",
        "-r",
        "--cached",
        "--ignore-unmatch",
        "--",
        repoPath,
      ]);
      untracked = true;
    }

    return {
      output: untracked
        ? `已忽略 ${repoPath}，并停止跟踪该路径（本地文件仍保留）。`
        : `已忽略 ${repoPath}。`,
      status: await this.status(),
      state: await this.ignoreState(),
    };
  }

  async removeIgnore(scope, lineNumber) {
    if (!["project", "local"].includes(scope)) {
      throw new Error("未知的忽略规则范围。");
    }

    const repositoryRoot = await this.repositoryRoot();
    const ignorePath =
      scope === "project"
        ? path.join(repositoryRoot, ".gitignore")
        : path.join(repositoryRoot, ".git", "info", "exclude");
    const content = await fs.readFile(ignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    const index = Number(lineNumber) - 1;
    if (index < 0 || index >= lines.length || !lines[index].trim()) {
      throw new Error("忽略规则已经发生变化，请刷新后重试。");
    }

    const [removed] = lines.splice(index, 1);
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    await fs.writeFile(ignorePath, lines.join(lineEnding), "utf8");
    return {
      output: `已移除忽略规则：${removed.trim()}`,
      status: await this.status(),
      state: await this.ignoreState(),
    };
  }

  async diff(filePath) {
    const change = (await this.status()).changes.find(
      (item) => item.path === filePath,
    );
    if (!change) {
      return "";
    }

    if (change.untracked) {
      const absolute = this.vaultService.resolveInsideVault(filePath);
      const content = await fs.readFile(absolute, "utf8");
      return [
        `diff --git a/${filePath} b/${filePath}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${filePath}`,
        ...content.split(/\r?\n/).map((line) => `+${line}`),
      ].join("\n");
    }

    const result = await this.run(
      ["diff", "HEAD", "--no-ext-diff", "--unified=3", "--", filePath],
      { allowCodes: [1, 128] },
    );
    return result.stdout || "该文件没有可显示的文本差异。";
  }

  async stage(paths, staged) {
    if (!paths.length) {
      return this.status();
    }

    if (staged) {
      await this.run(["reset", "HEAD", "--", ...paths], { allowCodes: [128] });
    } else {
      await this.run(["add", "--", ...paths]);
    }
    return this.status();
  }

  async commit(message, selectedPaths) {
    if (!message.trim()) {
      throw new Error("请输入提交说明。");
    }

    const current = await this.status();
    const selectedConflicts = current.changes.filter(
      (change) => selectedPaths.includes(change.path) && change.conflict,
    );
    if (selectedConflicts.length) {
      throw new Error(
        `存在尚未解决的冲突文件：${selectedConflicts
          .slice(0, 3)
          .map((change) => change.path)
          .join("、")}${selectedConflicts.length > 3 ? " 等" : ""}`,
      );
    }

    const stagedButNotSelected = current.changes
      .filter((change) => change.staged && !selectedPaths.includes(change.path))
      .map((change) => change.path);
    if (stagedButNotSelected.length) {
      throw new Error(
        `存在未勾选但已暂存的文件，请先取消暂存：${stagedButNotSelected
          .slice(0, 3)
          .join("、")}${stagedButNotSelected.length > 3 ? " 等" : ""}`,
      );
    }

    const pathsToStage = current.changes
      .filter((change) => selectedPaths.includes(change.path) && !change.staged)
      .map((change) => change.path);
    if (pathsToStage.length) {
      await this.run(["add", "--", ...pathsToStage]);
    }

    const stagedResult = await this.run([
      "diff",
      "--cached",
      "--name-only",
    ]);
    if (!stagedResult.stdout.trim()) {
      throw new Error("没有已暂存的更改可提交。");
    }

    const commitResult = await this.run(["commit", "-m", message.trim()]);
    return {
      output: commitResult.stdout.trim(),
      status: await this.status(),
    };
  }

  async fetch() {
    const result = await this.run(["fetch", "--prune"]);
    return {
      output: result.stdout.trim() || "已获取远端更新。",
      status: await this.status(),
    };
  }

  async pull() {
    const current = await this.status();
    if (current.changes.length) {
      throw new Error("当前有未提交改动。请先提交或撤销改动，再拉取远端。");
    }
    const result = await this.run(["pull", "--ff-only"]);
    return {
      output: result.stdout.trim(),
      status: await this.status(),
    };
  }

  async push() {
    const result = await this.run(["push"]);
    return {
      output: result.stderr.trim() || result.stdout.trim() || "已推送。",
      status: await this.status(),
    };
  }

  async log(filePath = "") {
    if (!(await this.isRepository())) {
      return [];
    }
    const args = [
      "log",
      "-n",
      "40",
      "--date=iso-strict",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e",
    ];
    if (filePath) {
      args.push("--", filePath);
    }
    const result = await this.run(args, { allowCodes: [128] });
    if (result.code !== 0 || !result.stdout) {
      return [];
    }
    return result.stdout
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, shortHash, author, date, subject] = entry.split("\x1f");
        return { hash, shortHash, author, date, subject };
      });
  }

  async show(hash) {
    const result = await this.run([
      "show",
      "--no-ext-diff",
      "--format=medium",
      "--stat",
      "--patch",
      hash,
    ]);
    return result.stdout;
  }
}

module.exports = {
  classifyGitChange,
  GitService,
  decodeGitStatus,
  normalizeRelativeGitPath,
  sanitizedGitEnvironment,
  toIgnorePattern,
};
