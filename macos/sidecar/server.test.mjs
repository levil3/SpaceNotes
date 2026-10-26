import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createEventBroadcaster,
  createSidecarServer,
} = require("./server.cjs");

const temporaryDirectories = [];
const runningServers = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "space-notes-sidecar-"));
  temporaryDirectories.push(root);
  const webRoot = path.join(root, "web");
  const noteRoot = path.join(root, "notes");
  await fs.mkdir(path.join(webRoot, "assets"), { recursive: true });
  await fs.mkdir(noteRoot, { recursive: true });
  await fs.writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><title>SpaceNotes</title>",
    "utf8",
  );
  await fs.writeFile(
    path.join(webRoot, "assets", "app.js"),
    "window.app = true;",
    "utf8",
  );
  await fs.writeFile(path.join(noteRoot, "image.png"), "png", "utf8");

  const api = {
    readNote: vi.fn(async (relativePath) => ({
      path: relativePath,
      content: "# Note",
    })),
    fail: vi.fn(async () => {
      throw new Error("预期失败。");
    }),
    raw: vi.fn(() => 42),
  };
  const internal = {
    refresh: vi.fn(async () => "refreshed"),
  };
  const vaultService = {
    resolveAsset: vi.fn(async (target, notePath) => {
      if (target === "missing.png") {
        throw new Error("图片不存在。");
      }
      return path.join(noteRoot, `${notePath}-${target}`);
    }),
    readResolvedFile: vi.fn(async (absolutePath) => ({
      content: await fs.readFile(absolutePath),
      stat: await fs.stat(absolutePath),
    })),
  };
  await fs.writeFile(path.join(noteRoot, "note-image.png"), "png", "utf8");
  const broadcaster = createEventBroadcaster();
  const sidecar = createSidecarServer({
    api,
    vaultService,
    webRoot,
    token: "test-token",
    internalToken: "internal-token",
    allowedOrigins: ["http://127.0.0.1:5173"],
    broadcaster,
    internalHandlers: internal,
  });
  const address = await sidecar.listen();
  runningServers.push(sidecar);

  return {
    api,
    internal,
    vaultService,
    broadcaster,
    sidecar,
    root,
    noteRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function authorizedRequest(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      ...init.headers,
    },
  });
}

function internalRequest(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer internal-token",
      ...init.headers,
    },
  });
}

async function waitForEventStream(reader, decoder) {
  const first = await reader.read();
  expect(decoder.decode(first.value)).toContain("retry: 1000");
}

describe("macOS sidecar HTTP contract", () => {
  it("rejects requests without the launch token", async () => {
    const { baseUrl } = await createFixture();

    const response = await fetch(`${baseUrl}/api/readNote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["note.md"] }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "未授权。",
    });
  });

  it("exchanges an initial query token for an app session cookie", async () => {
    const { baseUrl } = await createFixture();

    const response = await fetch(`${baseUrl}/?token=test-token`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain(
      "spacenotes_session=test-token",
    );
  });

  it("serves React assets after establishing a session", async () => {
    const { baseUrl } = await createFixture();
    const session = await fetch(`${baseUrl}/?token=test-token`, {
      redirect: "manual",
    });
    const cookie = session.headers.get("set-cookie").split(";")[0];

    const indexResponse = await fetch(`${baseUrl}/`, {
      headers: { Cookie: cookie },
    });
    const assetResponse = await fetch(`${baseUrl}/assets/app.js`, {
      headers: { Cookie: cookie },
    });

    expect(indexResponse.status).toBe(200);
    await expect(indexResponse.text()).resolves.toContain("SpaceNotes");
    await expect(assetResponse.text()).resolves.toContain("window.app");
  });

  it("invokes shared API methods and returns their JSON result", async () => {
    const { api, baseUrl } = await createFixture();

    const response = await authorizedRequest(`${baseUrl}/api/readNote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["notes/today.md"] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { path: "notes/today.md", content: "# Note" },
    });
    expect(api.readNote).toHaveBeenCalledWith("notes/today.md");
  });

  it("returns a user-visible API error and unknown method rejection", async () => {
    const { baseUrl } = await createFixture();

    const failure = await authorizedRequest(`${baseUrl}/api/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [] }),
    });
    const unknown = await authorizedRequest(`${baseUrl}/api/missing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [] }),
    });

    expect(failure.status).toBe(400);
    await expect(failure.json()).resolves.toEqual({ error: "预期失败。" });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({
      error: "未知 API 方法。",
    });
  });

  it("rejects null API and internal request bodies without reporting a server error", async () => {
    const { baseUrl } = await createFixture();

    const apiResponse = await authorizedRequest(`${baseUrl}/api/raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    const internalResponse = await internalRequest(
      `${baseUrl}/internal/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      },
    );

    expect(apiResponse.status).toBe(400);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "请求体必须是对象。",
    });
    expect(internalResponse.status).toBe(400);
    await expect(internalResponse.json()).resolves.toEqual({
      error: "请求体必须是对象。",
    });
  });

  it("does not let the renderer token call host-only methods", async () => {
    const { baseUrl } = await createFixture();

    const response = await authorizedRequest(
      `${baseUrl}/internal/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: [] }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未授权。" });
  });

  it("does not let the host token call renderer API methods", async () => {
    const { baseUrl } = await createFixture();

    const response = await internalRequest(`${baseUrl}/api/readNote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["note.md"] }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未授权。" });
  });

  it("supports the configured Vite development origin", async () => {
    const { baseUrl } = await createFixture();
    const response = await fetch(`${baseUrl}/api/raw`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173",
    );
  });

  it("streams vault-changed events to an authenticated subscriber", async () => {
    const { baseUrl, broadcaster } = await createFixture();
    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/events?token=test-token`,
      { signal: controller.signal },
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    await waitForEventStream(reader, decoder);
    broadcaster.broadcast({ path: "/notes", reason: "saved" });
    const first = await reader.read();
    controller.abort();

    expect(response.status).toBe(200);
    expect(decoder.decode(first.value)).toContain(
      '"reason":"saved"',
    );
  });

  it("resolves assets through the vault service and hides failures", async () => {
    const { baseUrl, vaultService } = await createFixture();
    const response = await authorizedRequest(
      `${baseUrl}/assets?target=image.png&note=note`,
    );
    const missing = await authorizedRequest(
      `${baseUrl}/assets?target=missing.png&note=note`,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("png");
    expect(vaultService.resolveAsset).toHaveBeenCalledWith(
      "image.png",
      "note",
    );
    expect(missing.status).toBe(404);
  });

  it("does not serve files outside the web root", async () => {
    const { baseUrl, root } = await createFixture();
    await fs.writeFile(path.join(root, "secret.txt"), "secret", "utf8");

    const response = await authorizedRequest(
      `${baseUrl}/..%2Fsecret.txt`,
    );

    expect(response.status).toBe(404);
  });
});
