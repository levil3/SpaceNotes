import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  UpdateService,
  compareVersions,
  parseVersion,
  selectAsset,
} = require("./update.cjs");

function releasePayload({
  tag = "v0.2.0",
  assets = [],
  body = "- 新增标签栏",
} = {}) {
  return {
    tag_name: tag,
    body,
    published_at: "2026-11-18T02:00:00Z",
    html_url: "https://github.com/levil3/SpaceNotes/releases/tag/v0.2.0",
    assets,
  };
}

function dmgAsset(name, overrides = {}) {
  return {
    name,
    size: 12,
    digest: "sha256:00",
    browser_download_url: `https://example.test/${name}`,
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function binaryResponse(bytes, status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(bytes.length) },
    body: stream,
    text: async () => "",
  };
}

describe("版本比较", () => {
  it("按数字段比较，而不是字符串比较", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v0.1.25", "0.2.0")).toBe(-1);
  });

  it("正式版高于同号预发布版", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });

  it("无法解析的版本号退化为相等，不抛异常", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(compareVersions("latest", "0.1.0")).toBe(0);
  });
});

describe("安装包选择", () => {
  const assets = [
    dmgAsset("Levil Notes 0.2.0-arm64.dmg"),
    dmgAsset("Levil Notes 0.2.0-x64.dmg"),
    dmgAsset("Levil Notes Setup 0.2.0.exe"),
    dmgAsset("Levil Notes 0.2.0-arm64.dmg.sha256"),
  ];

  it("Windows 只挑 Setup exe", () => {
    expect(selectAsset(assets, "win", "x64").name).toBe(
      "Levil Notes Setup 0.2.0.exe",
    );
  });

  it("macOS 按架构挑 DMG", () => {
    expect(selectAsset(assets, "mac", "arm64").name).toBe(
      "Levil Notes 0.2.0-arm64.dmg",
    );
    expect(selectAsset(assets, "mac", "x64").name).toBe(
      "Levil Notes 0.2.0-x64.dmg",
    );
  });

  it("缺对应架构时返回 null 而不是乱选", () => {
    const only = [dmgAsset("Levil Notes 0.2.0-arm64.dmg")];
    expect(selectAsset(only, "mac", "x64")).toBeNull();
    expect(selectAsset([], "win", "x64")).toBeNull();
  });
});

describe("UpdateService", () => {
  let cacheDir;
  const changes = [];

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "levil-update-"));
    changes.length = 0;
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function createService(fetchImpl, overrides = {}) {
    return new UpdateService({
      currentVersion: "0.1.25",
      platform: "win",
      arch: "x64",
      cacheDir,
      fetchImpl,
      onChange: (state) => changes.push(state.phase),
      ...overrides,
    });
  }

  it("发现新版本时进入 available 并带出更新说明", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        releasePayload({
          assets: [dmgAsset("Levil Notes Setup 0.2.0.exe")],
        }),
      ),
    );
    const service = createService(fetchImpl);
    const state = await service.check({ force: true });
    expect(state.phase).toBe("available");
    expect(state.info.version).toBe("0.2.0");
    expect(state.info.notes).toContain("标签栏");
    expect(state.canInstallInApp).toBe(true);
  });

  it("同版本或更低版本时进入 latest", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        releasePayload({
          tag: "v0.1.24",
          assets: [dmgAsset("Levil Notes Setup 0.1.24.exe")],
        }),
      ),
    );
    const service = createService(fetchImpl);
    expect((await service.check({ force: true })).phase).toBe("latest");
  });

  it("24 小时内复用缓存，不重复请求", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        releasePayload({
          assets: [dmgAsset("Levil Notes Setup 0.2.0.exe")],
        }),
      ),
    );
    const service = createService(fetchImpl);
    await service.check({ force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await service.check({ force: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(
      readFileSync(join(cacheDir, "update-check.json"), "utf8"),
    );
    expect(cached.info.version).toBe("0.2.0");
  });

  it("网络失败时进入 error 并保留原因", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    const service = createService(fetchImpl);
    const state = await service.check({ force: true });
    expect(state.phase).toBe("error");
    expect(state.error).toContain("ENOTFOUND");
  });

  it("静默检查失败时不进入 error 打扰用户", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const service = createService(fetchImpl);
    const state = await service.check({ silent: true });
    expect(state.phase).toBe("idle");
  });

  it("限流单独提示", async () => {
    const service = createService(async () => jsonResponse({}, 403));
    const state = await service.check({ force: true });
    expect(state.phase).toBe("error");
    expect(state.error).toContain("限流");
  });

  it("下载后按摘要校验通过并进入 ready", async () => {
    const bytes = [1, 2, 3, 4, 5];
    const digest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [
              dmgAsset("Levil Notes Setup 0.2.0.exe", {
                digest: `sha256:${digest}`,
              }),
            ],
          }),
        );
      }
      return binaryResponse(bytes);
    });
    const service = createService(fetchImpl);
    await service.check({ force: true });
    const state = await service.download();
    expect(state.phase).toBe("ready");
    expect(state.error).toBe("");
    const saved = readFileSync(
      join(cacheDir, "downloads", "Levil Notes Setup 0.2.0.exe"),
    );
    expect([...saved]).toEqual(bytes);
  });

  it("摘要不匹配时删除文件并退回 available", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [
              dmgAsset("Levil Notes Setup 0.2.0.exe", {
                digest: "sha256:deadbeef",
              }),
            ],
          }),
        );
      }
      return binaryResponse([9, 9, 9]);
    });
    const service = createService(fetchImpl);
    await service.check({ force: true });
    const state = await service.download();
    expect(state.phase).toBe("available");
    expect(state.error).toContain("校验失败");
  });

  it("安装计划：Windows 需要退出应用后再装", async () => {
    const bytes = [7];
    const digest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [
              dmgAsset("Levil Notes Setup 0.2.0.exe", {
                digest: `sha256:${digest}`,
              }),
            ],
          }),
        );
      }
      return binaryResponse(bytes);
    });
    const service = createService(fetchImpl);
    await service.check({ force: true });
    await service.download();
    const plan = service.installPlan();
    expect(plan.target).toContain("Levil Notes Setup 0.2.0.exe");
    expect(plan.quitAfterInstall).toBe(true);
  });

  it("安装计划：macOS 只打开 DMG，不退出应用", async () => {
    const bytes = [3];
    const digest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [
              dmgAsset("Levil Notes 0.2.0-arm64.dmg", {
                digest: `sha256:${digest}`,
              }),
            ],
          }),
        );
      }
      return binaryResponse(bytes);
    });
    const service = createService(fetchImpl, {
      platform: "mac",
      arch: "arm64",
    });
    const checked = await service.check({ force: true });
    expect(checked.canInstallInApp).toBe(false);
    await service.download();
    const plan = service.installPlan();
    expect(plan.target).toMatch(/\.dmg$/);
    expect(plan.quitAfterInstall).toBe(false);
    expect(service.releasePageUrl()).toContain("github.com");
  });

  it("未下载完就安装会报错", () => {
    const service = createService(async () => jsonResponse(releasePayload()));
    expect(() => service.installPlan()).toThrow();
  });

  it("取消下载后回到 available", async () => {
    const service = createService(async (url, options) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [dmgAsset("Levil Notes Setup 0.2.0.exe")],
          }),
        );
      }
      // 模拟一个永远下不完的响应，并且尊重 AbortSignal。
      return {
        ok: true,
        status: 200,
        headers: { get: () => "1000" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              controller.error(error);
            });
          },
        }),
      };
    });
    await service.check({ force: true });
    const pending = service.download();
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.cancel();
    const state = await pending;
    expect(state.phase).toBe("available");
    expect(state.error).toContain("取消");
  });

  it("重启后能识别已下载的安装包", async () => {
    const bytes = [4, 4];
    const digest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("api.github.com")) {
        return jsonResponse(
          releasePayload({
            assets: [
              dmgAsset("Levil Notes Setup 0.2.0.exe", {
                digest: `sha256:${digest}`,
              }),
            ],
          }),
        );
      }
      return binaryResponse(bytes);
    });
    const first = createService(fetchImpl);
    await first.check({ force: true });
    await first.download();

    const second = createService(fetchImpl);
    const restored = await second.restoreDownloaded();
    expect(restored.phase).toBe("ready");
    expect(restored.info.version).toBe("0.2.0");
  });
});
