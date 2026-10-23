import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createLevilNotesApi } = require("./api.cjs");
const { GitService } = require("./git.cjs");
const {
  createEventBroadcaster,
  createSidecarServer,
} = require("./sidecar.cjs");
const { SettingsStore, VaultService } = require("./vault.cjs");

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function request(baseUrl, method, args = []) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer integration-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ args }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error);
  }
  return body.result;
}

describe("sidecar with the real vault and Git services", () => {
  it("opens, reads, searches, saves and broadcasts through HTTP", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-sidecar-integration-"),
    );
    temporaryDirectories.push(root);
    const webRoot = path.join(root, "web");
    const vaultRoot = path.join(root, "vault");
    await fs.mkdir(webRoot, { recursive: true });
    await fs.mkdir(vaultRoot, { recursive: true });
    await fs.writeFile(
      path.join(webRoot, "index.html"),
      "<!doctype html><title>SpaceNotes</title>",
      "utf8",
    );
    await fs.writeFile(
      path.join(vaultRoot, "today.md"),
      "# Today\n\nA shared note.\n",
      "utf8",
    );

    const settings = new SettingsStore(
      path.join(root, "settings.json"),
    );
    await settings.load();
    const broadcaster = createEventBroadcaster();
    let sidecar;
    const vault = new VaultService(
      settings,
      (snapshot) => broadcaster.broadcast(snapshot),
    );
    const git = new GitService(vault);
    const sharedApi = createLevilNotesApi({
      vaultService: vault,
      gitService: git,
      settingsStore: settings,
      hostActions: {},
    });
    const api = {
      ...sharedApi,
      openVault: (rootPath) => vault.open(rootPath),
    };
    sidecar = createSidecarServer({
      api,
      vaultService: vault,
      webRoot,
      token: "integration-token",
      broadcaster,
    });

    try {
      const address = await sidecar.listen();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const opened = await request(baseUrl, "openVault", [vaultRoot]);
      expect(opened.files.map((file) => file.path)).toEqual([
        "today.md",
      ]);

      await expect(
        request(baseUrl, "readNote", ["today.md"]),
      ).resolves.toEqual({
        path: "today.md",
        content: "# Today\n\nA shared note.\n",
      });
      await expect(
        request(baseUrl, "search", ["shared", "all", "smart"]),
      ).resolves.toEqual([
        expect.objectContaining({ path: "today.md" }),
      ]);

      const controller = new AbortController();
      const events = await fetch(
        `${baseUrl}/events?token=integration-token`,
        { signal: controller.signal },
      );
      const reader = events.body.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain(
        "retry: 1000",
      );

      await request(baseUrl, "writeNote", [
        "today.md",
        "# Today\n\nSaved through sidecar.\n",
      ]);
      const eventChunk = decoder.decode((await reader.read()).value);
      controller.abort();
      expect(eventChunk).toContain('"reason":"saved"');
      await expect(
        fs.readFile(path.join(vaultRoot, "today.md"), "utf8"),
      ).resolves.toContain("Saved through sidecar.");
    } finally {
      await vault.closeWatcher();
      await sidecar.close();
    }
  });
});
