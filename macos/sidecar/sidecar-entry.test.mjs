import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const describeMac = process.platform === "darwin" ? describe : describe.skip;
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

describeMac("sidecar process contract", () => {
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

    const environment = { ...process.env };
    delete environment.SPACENOTES_TOKEN;
    const helperPath = path.resolve("build/macos/space-notes-fs");
    const child = spawn(
      process.execPath,
      [path.resolve("macos/sidecar/sidecar-entry.cjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...environment,
          SPACENOTES_SETTINGS_PATH: path.join(root, "settings.json"),
          SPACENOTES_WEB_ROOT: webRoot,
          SPACENOTES_PARENT_PID: String(process.pid),
          SPACENOTES_FS_HELPER: helperPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.add(child);
    child.stdin.end(
      "SPACENOTES_TOKEN=process-token-0123456789abcdef0123456789abcdef\n"
        + "SPACENOTES_INTERNAL_TOKEN={{SECRET_host_only}}\n",
    );
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
          Authorization:
            "Bearer process-token-0123456789abcdef0123456789abcdef",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ args: [] }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: null });

    const stream = await waitForSseResponse(
      ready.port,
      "process-token-0123456789abcdef0123456789abcdef",
    );
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

  it("does not expose the stdin launch token to Git hooks or ancestors", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "space-notes-sidecar-git-hook-"),
    );
    temporaryDirectories.push(root);
    const webRoot = path.join(root, "web");
    const vaultRoot = path.join(root, "vault");
    const leakPath = path.join(root, "ancestor-environments.txt");
    await fs.mkdir(webRoot, { recursive: true });
    await fs.mkdir(vaultRoot, { recursive: true });
    await fs.writeFile(
      path.join(webRoot, "index.html"),
      "<!doctype html><title>SpaceNotes</title>",
      "utf8",
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: vaultRoot });
    await execFileAsync("git", ["config", "user.name", "SpaceNotes Test"], {
      cwd: vaultRoot,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "spacenotes@example.test"],
      { cwd: vaultRoot },
    );
    await fs.writeFile(path.join(vaultRoot, "note.md"), "# Initial\n", "utf8");
    await execFileAsync("git", ["add", "note.md"], { cwd: vaultRoot });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: vaultRoot,
    });
    await fs.writeFile(path.join(vaultRoot, "note.md"), "# Changed\n", "utf8");

    const hookPath = path.join(vaultRoot, ".git", "hooks", "pre-commit");
    await fs.writeFile(
      hookPath,
      [
        "#!/bin/sh",
        "set -eu",
        `printf '%s\\n' 'hook-ran' > '${leakPath}'`,
        "pid=$PPID",
        'while [ "$pid" -gt 1 ]; do',
        `  /bin/ps eww -p "$pid" >> '${leakPath}' || true`,
        "  next=$(/bin/ps -o ppid= -p \"$pid\" | tr -d ' ')",
        '  [ -n "$next" ] || break',
        '  pid="$next"',
        "done",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.chmod(hookPath, 0o755);

    const token = "hook-token-0123456789abcdef0123456789abcdef";
    const environment = { ...process.env };
    delete environment.SPACENOTES_TOKEN;
    const helperPath = path.resolve("build/macos/space-notes-fs");
    const child = spawn(
      process.execPath,
      [path.resolve("macos/sidecar/sidecar-entry.cjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...environment,
          SPACENOTES_SETTINGS_PATH: path.join(root, "settings.json"),
          SPACENOTES_WEB_ROOT: webRoot,
          SPACENOTES_PARENT_PID: String(process.pid),
          SPACENOTES_FS_HELPER: helperPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.add(child);
    child.stdin.end(
      `SPACENOTES_TOKEN=${token}\n`
        + "SPACENOTES_INTERNAL_TOKEN={{SECRET_host_only}}\n",
    );
    try {
      const ready = await waitForReady(child);
      const response = await fetch(
        `http://127.0.0.1:${ready.port}/internal/openVault`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer {{SECRET_host_only}}",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ args: [vaultRoot] }),
        },
      );
      expect(response.status).toBe(200);

      const commitResponse = await fetch(
        `http://127.0.0.1:${ready.port}/api/gitCommit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            args: ["test: hook cannot read launch token", ["note.md"]],
          }),
        },
      );
      expect(commitResponse.status).toBe(200);
      const environments = await fs.readFile(leakPath, "utf8");
      expect(environments).toContain("hook-ran");
      expect(environments).toContain("SPACENOTES_SETTINGS_PATH=");
      expect(environments).not.toContain(token);
      expect(environments).not.toContain("SPACENOTES_TOKEN=");
      expect(environments).not.toContain("SPACENOTES_INTERNAL_TOKEN=");
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child);
      children.delete(child);
    }
  }, 15000);

  it.runIf(process.platform === "darwin")(
    "fails closed on macOS when the native file helper is missing",
    async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "space-notes-sidecar-missing-helper-"),
      );
      temporaryDirectories.push(root);
      const webRoot = path.join(root, "web");
      await fs.mkdir(webRoot, { recursive: true });
      await fs.writeFile(
        path.join(webRoot, "index.html"),
        "<!doctype html><title>SpaceNotes</title>",
        "utf8",
      );

      const environment = { ...process.env };
      delete environment.SPACENOTES_TOKEN;
      const child = spawn(
        process.execPath,
        [path.resolve("macos/sidecar/sidecar-entry.cjs")],
        {
          cwd: path.resolve("."),
          env: {
            ...environment,
            SPACENOTES_SETTINGS_PATH: path.join(root, "settings.json"),
            SPACENOTES_WEB_ROOT: webRoot,
            SPACENOTES_FS_HELPER: path.join(root, "missing-helper"),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      children.add(child);
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.end(
        "SPACENOTES_TOKEN=process-token-0123456789abcdef0123456789abcdef\n"
          + "SPACENOTES_INTERNAL_TOKEN={{SECRET_host_only}}\n",
      );

      await expect(waitForExit(child)).resolves.toBe(1);
      expect(stderr).toContain("macOS 文件安全组件缺失");
      children.delete(child);
    },
  );
});
