import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];
const children = new Set();

afterEach(async () => {
  for (const child of children) {
    child.kill("SIGKILL");
  }
  children.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`sidecar 启动超时：${stderr}`));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`sidecar 提前退出：${code}\n${stderr}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}

function waitForSseResponse(port, token) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/events",
        headers: { Authorization: `Bearer ${token}` },
      },
      (response) => resolve({ request, response }),
    );
    request.once("error", reject);
  });
}

describe("sidecar process contract", () => {
  it("shuts down cleanly on SIGTERM while SSE is connected", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-sidecar-process-"),
    );
    temporaryDirectories.push(root);
    const webRoot = path.join(root, "web");
    await fs.mkdir(webRoot, { recursive: true });
    await fs.writeFile(
      path.join(webRoot, "index.html"),
      "<!doctype html><title>SpaceNotes</title>",
      "utf8",
    );

    const child = spawn(
      process.execPath,
      [path.resolve("electron/sidecar-entry.cjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          SPACENOTES_TOKEN: "process-token",
          SPACENOTES_SETTINGS_PATH: path.join(root, "settings.json"),
          SPACENOTES_WEB_ROOT: webRoot,
          SPACENOTES_PARENT_PID: String(process.pid),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.add(child);
    const ready = await waitForReady(child);

    expect(ready).toMatchObject({
      type: "ready",
      host: "127.0.0.1",
    });
    expect(ready.port).toBeGreaterThan(0);

    const response = await fetch(
      `http://127.0.0.1:${ready.port}/api/restoreVault`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer process-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ args: [] }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: null });

    const stream = await waitForSseResponse(ready.port, "process-token");
    expect(stream.response.statusCode).toBe(200);

    child.kill("SIGTERM");
    await expect(
      Promise.race([
        waitForExit(child),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("sidecar did not exit with SSE connected")),
            3000,
          ),
        ),
      ]),
    ).resolves.toBe(0);
    stream.request.destroy();
    children.delete(child);
  });
});
