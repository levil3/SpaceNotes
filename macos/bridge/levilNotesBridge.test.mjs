import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

async function loadBridge({ fetchImpl, EventSourceImpl }) {
  const source = await fs.readFile(
    path.join("macos", "bridge", "levilNotesBridge.js"),
    "utf8",
  );
  const postedHostMessages = [];
  const window = {
    __SPACENOTES_BRIDGE_CONFIG__: {
      baseUrl: "http://127.0.0.1:43210",
      token: "bridge-token",
    },
    fetch: fetchImpl,
    EventSource: EventSourceImpl,
    webkit: {
      messageHandlers: {
        levilNotesHost: {
          postMessage: (message) => postedHostMessages.push(message),
        },
      },
    },
  };
  vm.runInNewContext(source, { window, JSON, Promise, Error, String, TypeError });
  return { window, postedHostMessages };
}

function response(result, ok = true, error = "") {
  return {
    ok,
    async json() {
      return ok ? { result } : { error };
    },
  };
}

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  emit(name, data) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) });
  }

  close() {
    this.closed = true;
  }
}

describe("WKWebView levilNotes bridge", () => {
  it("keeps the Windows preload and macOS bridge surfaces in sync", async () => {
    const preload = await fs.readFile(
      path.join("electron", "preload.cjs"),
      "utf8",
    );
    const preloadMethods = [
      ...preload.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):/gm),
    ].map((match) => match[1]).sort();
    const { window } = await loadBridge({
      fetchImpl: async () => response(null),
      EventSourceImpl: FakeEventSource,
    });

    expect(Object.keys(window.levilNotes).sort()).toEqual(preloadMethods);
  });

  it("queues host open-file requests until the app subscribes", async () => {
    const { window } = await loadBridge({
      fetchImpl: async () => response(null),
      EventSourceImpl: FakeEventSource,
    });

    window.__levilNotesOpenFileFromHost("notes/raft.md");
    const opened = [];
    const unsubscribe = window.__levilNotesHostEvents.onOpenFile((path) => {
      opened.push(path);
    });
    expect(opened).toEqual(["notes/raft.md"]);

    window.__levilNotesOpenFileFromHost("notes/second.md");
    expect(opened).toEqual(["notes/raft.md", "notes/second.md"]);

    unsubscribe();
    window.__levilNotesOpenFileFromHost("notes/ignored.md");
    expect(opened).toEqual(["notes/raft.md", "notes/second.md"]);
  });

  it("maps business calls to authenticated sidecar requests", async () => {
    const fetchImpl = vi.fn(async () =>
      response({ path: "note.md", content: "# Note" }),
    );
    const { window } = await loadBridge({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
    });

    await expect(window.levilNotes.readNote("note.md")).resolves.toEqual({
      path: "note.md",
      content: "# Note",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43210/api/readNote",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer bridge-token",
        }),
        body: JSON.stringify({ args: ["note.md"] }),
      }),
    );
  });

  it("maps commit preview through the shared Git API", async () => {
    const fetchImpl = vi.fn(async () => response({ output: "preview" }));
    const { window } = await loadBridge({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
    });

    await expect(
      window.levilNotes.gitPreviewCommit(["notes/today.md"]),
    ).resolves.toEqual({ output: "preview" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43210/api/gitPreviewCommit",
      expect.objectContaining({
        body: JSON.stringify({ args: [["notes/today.md"]] }),
      }),
    );
  });

  it("preserves the shared user-visible error message", async () => {
    const { window } = await loadBridge({
      fetchImpl: async () =>
        response(null, false, "请先打开一个笔记库。"),
      EventSourceImpl: FakeEventSource,
    });

    await expect(
      window.levilNotes.getVaultSnapshot(),
    ).rejects.toThrow("请先打开一个笔记库。");
  });

  it("keeps concurrent request results in call order", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const { args } = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, args[0] === 1 ? 20 : 1));
      return response(`note-${args[0]}`);
    });
    const { window } = await loadBridge({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
    });

    const [first, second] = await Promise.all([
      window.levilNotes.readNote(1),
      window.levilNotes.readNote(2),
    ]);

    expect(first).toBe("note-1");
    expect(second).toBe("note-2");
  });

  it("resolves and rejects native host operations by request id", async () => {
    const { window, postedHostMessages } = await loadBridge({
      fetchImpl: async () => response(null),
      EventSourceImpl: FakeEventSource,
    });

    const chosen = window.levilNotes.chooseVault();
    const failed = window.levilNotes.showInFolder("missing.md");
    expect(postedHostMessages).toEqual([
      { id: 1, name: "chooseVault", args: [] },
      { id: 2, name: "showInFolder", args: ["missing.md"] },
    ]);

    window.__levilNotesHostResolve(1, { path: "/tmp/vault" });
    window.__levilNotesHostReject(2, "文件不存在。");

    await expect(chosen).resolves.toEqual({ path: "/tmp/vault" });
    await expect(failed).rejects.toThrow("文件不存在。");
  });

  it("streams vault changes and closes SSE after the last unsubscribe", async () => {
    FakeEventSource.instances = [];
    const { window } = await loadBridge({
      fetchImpl: async () => response(null),
      EventSourceImpl: FakeEventSource,
    });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = window.levilNotes.onVaultChanged(first);
    const unsubscribeSecond = window.levilNotes.onVaultChanged(second);
    const source = FakeEventSource.instances[0];

    expect(source.url).toBe(
      "http://127.0.0.1:43210/events?token=bridge-token",
    );
    source.emit("vault-changed", { reason: "saved" });
    expect(first).toHaveBeenCalledWith({ reason: "saved" });
    expect(second).toHaveBeenCalledWith({ reason: "saved" });

    unsubscribeFirst();
    expect(source.closed).toBe(false);
    unsubscribeSecond();
    expect(source.closed).toBe(true);
  });
});
