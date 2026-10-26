const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createLevilNotesApi } = require("../../electron/api.cjs");
const { GitService } = require("../../electron/git.cjs");
const {
  createEventBroadcaster,
  createSidecarServer,
} = require("../sidecar/server.cjs");
const {
  SettingsStore,
  VaultService,
} = require("../../electron/vault.cjs");
const {
  createNativeFileOperations,
} = require("../sidecar/file-operations.cjs");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REPORT = path.join(
  ROOT,
  "build",
  "macos",
  "usage-model-report.json",
);

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

async function listMarkdownFiles(directory, prefix = "") {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listMarkdownFiles(absolute, relative)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(relative);
    }
  }
  return output.sort();
}

async function hashMarkdownFiles(vaultRoot) {
  const files = await listMarkdownFiles(vaultRoot);
  const hash = crypto.createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(vaultRoot, relative)));
    hash.update("\0");
  }
  return { hash: hash.digest("hex"), files };
}

async function gitReference(vaultRoot) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: vaultRoot, encoding: "utf8" },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

function eventQueue(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const separator = buffer.indexOf("\n\n");
        if (separator !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) {
            return JSON.parse(data.slice("data: ".length));
          }
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error("SSE 在预期事件前结束。");
        }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

async function waitForMutationEvent(reader, expectedReason) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const event = await reader.next();
    if (event.reason === expectedReason) {
      return event;
    }
    if (event.reason === "external-change") {
      continue;
    }
  }
  throw new Error(`未在事件流中观察到 ${expectedReason}。`);
}

async function createFixture() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "spacenotes-usage-model-"),
  );
  const vaultRoot = path.join(root, "vault");
  const webRoot = path.join(root, "web");
  const trashRoot = path.join(root, "trash");
  const remoteRoot = path.join(root, "remote.git");
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.mkdir(webRoot, { recursive: true });
  await fs.mkdir(trashRoot, { recursive: true });
  await fs.writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><title>SpaceNotes usage model</title>",
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "image.png"),
    Buffer.from("usage-model-image"),
  );
  for (let index = 0; index < 8; index += 1) {
    await fs.writeFile(
      path.join(vaultRoot, `note-${index}.md`),
      `# Note ${index}\n\nseed content ${index} #model\n`,
      "utf8",
    );
  }
  await execFileAsync("git", ["init", "-q", "-b", "main"], {
    cwd: vaultRoot,
  });
  await execFileAsync("git", ["config", "user.name", "SpaceNotes Model"], {
    cwd: vaultRoot,
  });
  await execFileAsync(
    "git",
    ["config", "user.email", "model@example.invalid"],
    { cwd: vaultRoot },
  );
  await execFileAsync("git", ["init", "--bare", "-q", remoteRoot]);
  await execFileAsync("git", ["add", "."], { cwd: vaultRoot });
  await execFileAsync("git", ["commit", "-qm", "seed"], { cwd: vaultRoot });
  await execFileAsync(
    "git",
    ["remote", "add", "origin", remoteRoot],
    { cwd: vaultRoot },
  );
  await execFileAsync(
    "git",
    ["push", "-q", "-u", "origin", "main"],
    { cwd: vaultRoot },
  );
  return { root, vaultRoot, webRoot, trashRoot };
}

async function post(baseUrl, token, method, args = []) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ args }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body.result;
}

async function createBridge(baseUrl, token, postToSidecar) {
  const source = await fs.readFile(
    path.join(ROOT, "macos", "bridge", "levilNotesBridge.js"),
    "utf8",
  );
  const window = {
    __SPACENOTES_BRIDGE_CONFIG__: { baseUrl, token },
    fetch,
    webkit: {
      messageHandlers: {
        levilNotesHost: {
          postMessage(message) {
            if (message.name !== "trashNote") {
              window.__levilNotesHostReject(
                message.id,
                `usage model does not support host action ${message.name}`,
              );
              return;
            }
            postToSidecar(
              "trashNote",
              Array.isArray(message.args) ? message.args : [],
            ).then(
              (result) => window.__levilNotesHostResolve(message.id, result),
              (error) =>
                window.__levilNotesHostReject(message.id, error.message),
            );
          },
        },
      },
    },
  };
  vm.runInNewContext(source, {
    window,
    JSON,
    Promise,
    Error,
    String,
    TypeError,
  });
  return {
    call(method, args = []) {
      return window.levilNotes[method](...args);
    },
  };
}

async function main() {
  const iterations = Number(argumentValue("--iterations", "3000"));
  const seed = Number(argumentValue("--seed", "20261023"));
  const reportPath = path.resolve(
    argumentValue("--report", DEFAULT_REPORT),
  );
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("--iterations 必须是正整数。");
  }
  if (!Number.isInteger(seed)) {
    throw new Error("--seed 必须是整数。");
  }

  const fixture = await createFixture();
  const settings = new SettingsStore(path.join(fixture.root, "settings.json"));
  await settings.load();
  await settings.save({ recentVault: fixture.vaultRoot });
  const broadcaster = createEventBroadcaster();
  let trashSequence = 0;
  const nativeFileOperations =
    process.platform === "darwin"
      ? createNativeFileOperations(
          path.join(ROOT, "build", "macos", "space-notes-fs"),
        )
      : null;
  const vault = new VaultService(
    settings,
    (snapshot) => broadcaster.broadcast(snapshot),
    {
      trashItem: async (absolutePath) => {
        trashSequence += 1;
        await fs.rename(
          absolutePath,
          path.join(
            fixture.trashRoot,
            `${trashSequence}-${path.basename(absolutePath)}`,
          ),
        );
      },
      ...(nativeFileOperations ? { fileOperations: nativeFileOperations } : {}),
    },
  );
  const git = new GitService(vault);
  const sharedApi = createLevilNotesApi({
    vaultService: vault,
    gitService: git,
    settingsStore: settings,
    hostActions: {},
  });
  const api = { ...sharedApi };
  const token = crypto.randomBytes(24).toString("hex");
  const sidecar = createSidecarServer({
    api,
    vaultService: vault,
    webRoot: fixture.webRoot,
    token,
    broadcaster,
  });

  const failures = [];
  const operationTypes = {};
  let bridgeCalls = 0;
  let assetChecks = 0;
  let lastGitHead = "";
  let eventReader;
  let events;
  try {
    const address = await sidecar.listen();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const bridge = await createBridge(
      baseUrl,
      token,
      (method, args) => post(baseUrl, token, method, args),
    );
    const bridgeCall = async (method, args = []) => {
      bridgeCalls += 1;
      return bridge.call(method, args);
    };
    await bridgeCall("restoreVault");
    const controller = new AbortController();
    const eventResponse = await fetch(
      `${baseUrl}/events?token=${encodeURIComponent(token)}`,
      { signal: controller.signal },
    );
    const sseReader = eventResponse.body.getReader();
    await sseReader.read();
    eventReader = eventQueue(sseReader);

    const random = mulberry32(seed);
    const expected = new Map();
    for (const relative of await listMarkdownFiles(fixture.vaultRoot)) {
      expected.set(
        relative,
        await fs.readFile(path.join(fixture.vaultRoot, relative), "utf8"),
      );
    }
    let createdSequence = 0;

    for (let sample = 0; sample < iterations; sample += 1) {
      const roll = random();
      const paths = [...expected.keys()].sort();
      const relative = paths[Math.floor(random() * paths.length)];
      let operation = "";
      let expectedEvent = "";
      try {
        if (roll < 0.53) {
          operation = "readNote";
          const result = await bridgeCall("readNote", [relative]);
          if (result.content !== expected.get(relative)) {
            throw new Error("readNote 返回值与预期文件不一致。");
          }
        } else if (roll < 0.66) {
          operation = "search";
          const result = await bridgeCall("search", [
            "seed",
            "all",
            "smart",
          ]);
          if (!Array.isArray(result)) {
            throw new Error("search 未返回数组。");
          }
        } else if (roll < 0.74) {
          operation = "getOutline";
          const result = await bridgeCall("getOutline", [relative]);
          if (!Array.isArray(result)) {
            throw new Error("getOutline 未返回数组。");
          }
        } else if (roll < 0.80) {
          operation = "getTags";
          const result = await bridgeCall("getTags");
          if (!Array.isArray(result)) {
            throw new Error("getTags 未返回数组。");
          }
        } else if (roll < 0.84) {
          operation = "readAsset";
          const response = await fetch(
            `${baseUrl}/assets?target=image.png&note=${encodeURIComponent(relative)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const content = await response.text();
          if (!response.ok || content !== "usage-model-image") {
            throw new Error("附件读取失败。");
          }
          assetChecks += 1;
        } else if (roll < 0.92 || expected.size > 30) {
          operation = "writeNote";
          expectedEvent = "saved";
          const content = `# ${path.basename(relative, ".md")}\n\nsample ${sample} seed ${seed}\n`;
          await bridgeCall("writeNote", [relative, content]);
          expected.set(relative, content);
        } else if (roll < 0.95) {
          operation = "createNote";
          expectedEvent = "created";
          createdSequence += 1;
          const result = await bridgeCall("createNote", [
            "",
            `model-created-${seed}-${createdSequence}`,
          ]);
          expected.set(result.path, result.content);
        } else if (roll < 0.97) {
          operation = "renameNote";
          expectedEvent = "renamed";
          const source = paths[Math.floor(random() * paths.length)];
          const result = await bridgeCall("renameNote", [
            source,
            `model-renamed-${seed}-${sample}`,
          ]);
          const content = expected.get(source);
          expected.delete(source);
          expected.set(result.path, content);
        } else if (roll < 0.985) {
          operation = "trashNote";
          expectedEvent = "trashed";
          await bridgeCall("trashNote", [relative]);
          expected.delete(relative);
        } else {
          operation = "gitStatus";
          const status = await bridgeCall("gitStatus");
          if (status.repository !== true) {
            throw new Error("Git 状态未识别当前仓库。");
          }
        }
        operationTypes[operation] = (operationTypes[operation] || 0) + 1;
        if (expectedEvent) {
          await waitForMutationEvent(eventReader, expectedEvent);
        }
        const actual = await hashMarkdownFiles(fixture.vaultRoot);
        const expectedHash = crypto.createHash("sha256");
        for (const [filePath, content] of [...expected.entries()].sort()) {
          expectedHash.update(filePath);
          expectedHash.update("\0");
          expectedHash.update(content);
          expectedHash.update("\0");
        }
        if (actual.hash !== expectedHash.digest("hex")) {
          throw new Error("笔记内容哈希与预期不一致。");
        }
        lastGitHead = await gitReference(fixture.vaultRoot);
      } catch (error) {
        failures.push({
          sample,
          operation,
          relative,
          message: error.message,
        });
        if (failures.length >= 20) {
          break;
        }
      }
    }
    controller.abort();

    const gitStatusBeforeCommit = await bridgeCall("gitStatus");
    const gitBranches = await bridgeCall("gitBranches");
    const gitLog = await bridgeCall("gitLog");
    const finalContent = "# Certified\n\nGit flow complete.\n";
    await fs.writeFile(
      path.join(fixture.vaultRoot, "certification.md"),
      finalContent,
      "utf8",
    );
    const gitStatusWithCertification = await bridgeCall("gitStatus");
    const commitPaths = gitStatusWithCertification.changes.map(
      (change) => change.path,
    );
    await bridgeCall("gitStage", [commitPaths, false]);
    const commit = await bridgeCall("gitCommit", [
      "test: certify macOS usage model",
      commitPaths,
    ]);
    const push = await bridgeCall("gitPush");
    const pull = await bridgeCall("gitPull");
    const gitStatusAfterCommit = await bridgeCall("gitStatus");
    const headAfter = await gitReference(fixture.vaultRoot);

    const report = {
      generatedAt: new Date().toISOString(),
      status: failures.length === 0 ? "PASS" : "FAIL",
      iterationsRequested: iterations,
      operationsExecuted: Object.values(operationTypes).reduce(
        (sum, count) => sum + count,
        0,
      ),
      seed,
      operationTypes,
      transport: {
        bridgeCalls,
        assetChecks,
        bridge:
          "levilNotesBridge.js contract over authenticated sidecar HTTP; " +
          "executed outside WebKit",
      },
      failures,
      eventVerified: true,
      dataIntegrity: failures.length === 0 ? "zero-corruption" : "failed",
      git: {
        initialHead: lastGitHead,
        committedHead: headAfter,
        commitOutput: commit.output,
        pushOutput: push.output,
        pullOutput: pull.output,
        branchCount: gitBranches.length,
        logCount: gitLog.length,
        changedBeforeCommit:
          gitStatusBeforeCommit.changes.length +
          gitStatusWithCertification.changes.length,
        statusClean: gitStatusAfterCommit.changes.length === 0,
      },
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        os: os.release(),
        fixtureRoot: fixture.root,
        fileAccess: nativeFileOperations
          ? "native-fd-relative-helper"
          : "node-fs-fallback",
      },
    };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    if (failures.length) {
      process.exitCode = 1;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await vault.closeWatcher();
    await sidecar.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
