/**
 * 应用内更新：检查 GitHub Releases、下载安装包、校验摘要、交给宿主安装。
 *
 * 该服务不依赖 Electron，Electron 主进程和 macOS sidecar 共用同一份实现。
 * 宿主差异不下沉到这里：服务只负责“该装哪个文件”，由调用方决定用
 * shell.openPath（Electron）还是宿主桥（macOS 的 NSWorkspace）打开。
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const DEFAULT_REPOSITORY = "levil3/SpaceNotes";
const CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 慢网络下 48 MB 的安装包可能要十几分钟，给足时间再判定超时。
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

const PHASES = Object.freeze([
  "idle",
  "checking",
  "latest",
  "available",
  "downloading",
  "ready",
  "error",
]);

/** 把 "v1.2.3" / "1.2.3-beta.2" 解析成可比较的片段。 */
function parseVersion(value) {
  const text = String(value || "").trim().replace(/^v/i, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) {
    return null;
  }
  return {
    numbers: [
      Number(match[1] || 0),
      Number(match[2] || 0),
      Number(match[3] || 0),
    ],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
 * 无法解析时按 0 处理，避免异常字符串把更新流程卡死。
 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] > right.numbers[index] ? 1 : -1;
    }
  }
  // 正式版高于同号预发布版：1.0.0 > 1.0.0-beta.1
  if (!left.prerelease.length && !right.prerelease.length) {
    return 0;
  }
  if (!left.prerelease.length) {
    return 1;
  }
  if (!right.prerelease.length) {
    return -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

/** 按平台与架构从 release 资源里挑出要下载的那个安装包。 */
function selectAsset(assets, platform, arch) {
  const list = Array.isArray(assets) ? assets : [];
  const named = list.filter(
    (asset) => asset && typeof asset.name === "string" && asset.name,
  );
  if (platform === "win") {
    return (
      named.find((asset) => /setup .*\.exe$/i.test(asset.name)) ||
      named.find((asset) => /\.exe$/i.test(asset.name)) ||
      null
    );
  }
  const dmgFiles = named.filter((asset) => /\.dmg$/i.test(asset.name));
  if (!dmgFiles.length) {
    return null;
  }
  if (arch === "arm64") {
    return dmgFiles.find((asset) => /arm64/i.test(asset.name)) || null;
  }
  if (arch === "x64") {
    return (
      dmgFiles.find((asset) => /x64|x86_64|intel/i.test(asset.name)) ||
      dmgFiles.find((asset) => !/arm64/i.test(asset.name)) ||
      null
    );
  }
  return dmgFiles.find((asset) => !/arm64|x64|x86_64/i.test(asset.name)) || dmgFiles[0];
}

function emptyState() {
  return {
    phase: "idle",
    currentVersion: "",
    info: null,
    progress: 0,
    error: "",
    lastCheckedAt: 0,
    canInstallInApp: false,
  };
}

function normalizeState(state) {
  const phase = PHASES.includes(state.phase) ? state.phase : "idle";
  const progress = Number(state.progress);
  return {
    phase,
    currentVersion: String(state.currentVersion || ""),
    info: state.info || null,
    progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
    error: String(state.error || ""),
    lastCheckedAt: Number(state.lastCheckedAt) || 0,
    canInstallInApp: Boolean(state.canInstallInApp),
  };
}

class UpdateService {
  constructor({
    currentVersion,
    platform,
    arch,
    cacheDir,
    repository = DEFAULT_REPOSITORY,
    apiBase = "https://api.github.com",
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    onChange = () => {},
  }) {
    this.currentVersion = currentVersion;
    this.platform = platform === "win" ? "win" : "mac";
    this.arch = arch;
    this.cacheDir = cacheDir;
    this.repository = repository;
    this.apiBase = String(apiBase || "https://api.github.com").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onChange = onChange;
    this.state = {
      ...emptyState(),
      currentVersion,
      canInstallInApp: this.platform === "win",
    };
    this.controller = null;
    this.cancelled = false;
    this.downloadPromise = null;
    this.cacheFile = path.join(cacheDir, "update-check.json");
    this.installerPath = null;
  }

  getState() {
    return normalizeState({ ...this.state });
  }

  setState(patch) {
    this.state = normalizeState({ ...this.state, ...patch });
    try {
      this.onChange(this.getState());
    } catch {
      // 状态广播失败不能影响更新流程本身。
    }
    return this.getState();
  }

  async readCache() {
    try {
      const raw = await fsp.readFile(this.cacheFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // 没有缓存或缓存损坏时按未检查处理。
    }
    return null;
  }

  async writeCache(payload) {
    try {
      await fsp.mkdir(this.cacheDir, { recursive: true });
      await fsp.writeFile(this.cacheFile, JSON.stringify(payload), "utf8");
    } catch {
      // 缓存写不进去只影响下次是否重新检查。
    }
  }

  /** 自动检查：24 小时内复用缓存结果，失败静默（用于启动时）。 */
  async check({ force = false, silent = false } = {}) {
    if (this.state.phase === "downloading") {
      return this.getState();
    }
    if (!force) {
      const cached = await this.readCache();
      if (
        cached &&
        this.now() - Number(cached.checkedAt || 0) < CHECK_CACHE_TTL_MS
      ) {
        if (cached.info) {
          return this.setState({
            phase: "available",
            info: cached.info,
            error: "",
            lastCheckedAt: Number(cached.checkedAt) || 0,
          });
        }
        return this.setState({
          phase: "latest",
          info: null,
          error: "",
          lastCheckedAt: Number(cached.checkedAt) || 0,
        });
      }
    }

    this.setState({ phase: "checking", error: "" });
    try {
      const info = await this.fetchLatest();
      const checkedAt = this.now();
      if (info && compareVersions(info.version, this.currentVersion) > 0) {
        await this.writeCache({ checkedAt, info });
        return this.setState({
          phase: "available",
          info,
          error: "",
          lastCheckedAt: checkedAt,
        });
      }
      await this.writeCache({ checkedAt, info: null });
      return this.setState({
        phase: "latest",
        info: null,
        error: "",
        lastCheckedAt: checkedAt,
      });
    } catch (error) {
      const message =
        error && error.message ? error.message : "检查更新失败。";
      if (silent) {
        // 启动时的静默检查失败不应打扰用户，保持原状态即可。
        return this.setState({ phase: "idle", error: message });
      }
      return this.setState({ phase: "error", error: message });
    }
  }

  async fetchLatest() {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("当前运行环境缺少网络能力。");
    }
    const url = `${this.apiBase}/repos/${this.repository}/releases/latest`;
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Levil-Notes-Updater",
      },
    });
    if (response.status === 404) {
      throw new Error("仓库还没有发布版本。");
    }
    if (response.status === 403 || response.status === 429) {
      throw new Error("GitHub 接口触发限流，请稍后再试。");
    }
    if (!response.ok) {
      throw new Error(`GitHub 返回 ${response.status}。`);
    }
    const release = await response.json();
    const version = String(release.tag_name || release.name || "").replace(
      /^v/i,
      "",
    );
    if (!parseVersion(version)) {
      throw new Error("无法识别发布版本号。");
    }
    const asset = selectAsset(release.assets, this.platform, this.arch);
    if (!asset) {
      throw new Error(
        this.platform === "win"
          ? "该版本没有提供 Windows 安装包。"
          : "该版本没有提供当前架构的 DMG。",
      );
    }
    return {
      version,
      notes: String(release.body || "").trim(),
      publishedAt: String(release.published_at || ""),
      fileName: asset.name,
      sizeBytes: Number(asset.size) || 0,
      digest: typeof asset.digest === "string" ? asset.digest : "",
      downloadUrl:
        typeof asset.browser_download_url === "string"
          ? asset.browser_download_url
          : "",
      releaseUrl: String(release.html_url || ""),
    };
  }

  async download() {
    if (this.downloadPromise) {
      return this.downloadPromise;
    }
    const info = this.state.info;
    if (!info || !info.downloadUrl) {
      throw new Error("没有可下载的更新。");
    }
    this.downloadPromise = this.downloadOnce(info).finally(() => {
      this.downloadPromise = null;
    });
    return this.downloadPromise;
  }

  async downloadOnce(info) {
    this.setState({ phase: "downloading", progress: 0, error: "" });
    const controller = new AbortController();
    this.controller = controller;
    this.cancelled = false;
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const target = path.join(this.cacheDir, "downloads", info.fileName);
    let handle = null;
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rm(target, { force: true });
      const response = await this.fetchImpl(info.downloadUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "Levil-Notes-Updater" },
      });
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status}。`);
      }
      const total = Number(response.headers.get("content-length")) || info.sizeBytes;
      const hash = crypto.createHash("sha256");
      let received = 0;
      handle = await fsp.open(target, "w");
      if (!response.body) {
        throw new Error("下载响应为空。");
      }
      for await (const chunk of Readable.fromWeb(response.body)) {
        received += chunk.length;
        hash.update(chunk);
        await handle.write(chunk);
        if (total > 0) {
          this.setState({
            phase: "downloading",
            progress: Math.min(99, (received / total) * 100),
          });
        }
      }
      await handle.close();
      handle = null;

      const actual = hash.digest("hex");
      const expected = await this.resolveExpectedDigest(info);
      if (expected && expected !== actual) {
        await fsp.rm(target, { force: true });
        throw new Error("安装包校验失败，已删除下载文件。");
      }
      if (!expected) {
        // 没有可用摘要时仍然允许安装，但要把风险写在状态里。
        this.setState({ error: "未提供摘要，已跳过校验。" });
      }
      this.installerPath = target;
      return this.setState({
        phase: "ready",
        progress: 100,
        error: expected ? "" : "未提供摘要，已跳过校验。",
      });
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fsp.rm(target, { force: true }).catch(() => {});
      this.installerPath = null;
      const aborted = error && error.name === "AbortError";
      const message = this.cancelled
        ? "下载已取消。"
        : aborted
          ? "下载已超时，请重试。"
          : error.message || "下载失败。";
      return this.setState({
        phase: "available",
        progress: 0,
        error: message,
      });
    } finally {
      clearTimeout(timeout);
      this.controller = null;
    }
  }

  /** release 资源的 digest 优先；缺失时回退到同名的 .sha256 文件。 */
  async resolveExpectedDigest(info) {
    if (typeof info.digest === "string" && info.digest.startsWith("sha256:")) {
      return info.digest.slice("sha256:".length).toLowerCase();
    }
    if (!info.downloadUrl) {
      return "";
    }
    try {
      const response = await this.fetchImpl(`${info.downloadUrl}.sha256`, {
        headers: { "User-Agent": "Levil-Notes-Updater" },
      });
      if (!response.ok) {
        return "";
      }
      const text = (await response.text()).trim();
      const match = /^([0-9a-f]{64})/i.exec(text);
      return match ? match[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }

  cancel() {
    if (this.controller) {
      this.cancelled = true;
      this.controller.abort();
    }
    return this.getState();
  }

  /**
   * 返回“该怎么装”，由宿主决定如何打开：
   *   - Electron 有 shell.openPath，可以直接打开安装包；
   *   - macOS sidecar 没有打开能力，把路径交回渲染层走宿主桥。
   */
  installPlan() {
    if (this.state.phase !== "ready" || !this.installerPath) {
      throw new Error("安装包还没下载完成。");
    }
    return {
      target: this.installerPath,
      quitAfterInstall: this.platform === "win",
    };
  }

  releasePageUrl() {
    return (
      (this.state.info && this.state.info.releaseUrl) ||
      `https://github.com/${this.repository}/releases/latest`
    );
  }

  /** 恢复到可安装状态（应用重启后仍能找到已下载的安装包）。 */
  async restoreDownloaded() {
    try {
      const cache = await this.readCache();
      const info = cache && cache.info;
      if (!info || compareVersions(info.version, this.currentVersion) <= 0) {
        return this.getState();
      }
      const target = path.join(this.cacheDir, "downloads", info.fileName);
      const stats = await fsp.stat(target).catch(() => null);
      if (!stats || !stats.isFile() || stats.size === 0) {
        return this.getState();
      }
      this.installerPath = target;
      return this.setState({ phase: "ready", info, progress: 100 });
    } catch {
      return this.getState();
    }
  }
}

module.exports = {
  UpdateService,
  compareVersions,
  parseVersion,
  selectAsset,
  PHASES,
};
