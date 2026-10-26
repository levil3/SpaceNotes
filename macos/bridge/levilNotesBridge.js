(function installLevilNotesBridge() {
  function createBridge(config, host, runtime) {
    const fetchImpl = runtime.fetch;
    const EventSourceImpl = runtime.EventSource;
    const token = config.token;
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    const pendingHostRequests = new Map();
    const subscribers = new Set();
    let nextHostRequestId = 1;
    let eventSource = null;

    function apiUrl(path) {
      return baseUrl + path;
    }

    async function invoke(method, args) {
      const response = await fetchImpl(apiUrl("/api/" + method), {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ args: args || [] }),
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        // A transport failure may not include a JSON body.
      }
      if (!response.ok) {
        throw new Error(payload.error || "请求失败。");
      }
      return payload.result;
    }

    function requestHost(name, args) {
      if (
        !host ||
        !host.postMessage ||
        typeof host.postMessage !== "function"
      ) {
        return Promise.reject(new Error("当前宿主不支持该操作。"));
      }
      const id = nextHostRequestId;
      nextHostRequestId += 1;
      return new Promise((resolve, reject) => {
        pendingHostRequests.set(id, { resolve, reject });
        try {
          host.postMessage({ id, name, args: args || [] });
        } catch (error) {
          pendingHostRequests.delete(id);
          reject(error);
        }
      });
    }

    function settleHostRequest(id, result, error) {
      const request = pendingHostRequests.get(id);
      if (!request) {
        return;
      }
      pendingHostRequests.delete(id);
      if (error) {
        request.reject(new Error(String(error)));
      } else {
        request.resolve(result);
      }
    }

    function openEventSource() {
      if (eventSource || subscribers.size === 0) {
        return;
      }
      eventSource = new EventSourceImpl(
        apiUrl("/events?token=" + encodeURIComponent(token)),
      );
      eventSource.addEventListener("vault-changed", (event) => {
        let snapshot;
        try {
          snapshot = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const subscriber of [...subscribers]) {
          try {
            subscriber(snapshot);
          } catch {
            // One subscriber must not prevent delivery to the others.
          }
        }
      });
    }

    function closeEventSourceIfIdle() {
      if (subscribers.size === 0 && eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    const api = {
      chooseVault: () => requestHost("chooseVault"),
      restoreVault: () => invoke("restoreVault"),
      getVaultSnapshot: () => invoke("getVaultSnapshot"),
      readNote: (relativePath) => invoke("readNote", [relativePath]),
      writeNote: (relativePath, content) =>
        invoke("writeNote", [relativePath, content]),
      createNote: (parentPath, title) =>
        invoke("createNote", [parentPath, title]),
      trashNote: (relativePath) =>
        requestHost("trashNote", [relativePath]),
      renameNote: (relativePath, title) =>
        invoke("renameNote", [relativePath, title]),
      getNoteHistory: (relativePath) =>
        invoke("getNoteHistory", [relativePath]),
      search: (query, scope, mode) =>
        invoke("search", [query, scope, mode]),
      getOutline: (relativePath) =>
        invoke("getOutline", [relativePath]),
      getBacklinks: (relativePath) =>
        invoke("getBacklinks", [relativePath]),
      getTags: () => invoke("getTags"),
      gitStatus: () => invoke("gitStatus"),
      gitDiff: (relativePath) => invoke("gitDiff", [relativePath]),
      gitStage: (paths, staged) =>
        invoke("gitStage", [paths, staged]),
      gitCommit: (message, selectedPaths) =>
        invoke("gitCommit", [message, selectedPaths]),
      gitPreviewCommit: (selectedPaths) =>
        invoke("gitPreviewCommit", [selectedPaths]),
      gitFetch: () => invoke("gitFetch"),
      gitPull: () => invoke("gitPull"),
      gitPush: () => invoke("gitPush"),
      gitDiscard: (paths) => invoke("gitDiscard", [paths]),
      gitBranches: () => invoke("gitBranches"),
      gitCreateBranch: (name) =>
        invoke("gitCreateBranch", [name]),
      gitCheckoutBranch: (name) =>
        invoke("gitCheckoutBranch", [name]),
      gitIgnoreState: () => invoke("gitIgnoreState"),
      gitAddIgnore: (options) =>
        invoke("gitAddIgnore", [options]),
      gitRemoveIgnore: (scope, line) =>
        invoke("gitRemoveIgnore", [scope, line]),
      gitLog: (relativePath) => invoke("gitLog", [relativePath]),
      gitShow: (hash) => invoke("gitShow", [hash]),
      getSettings: () => invoke("getSettings"),
      saveSettings: (updates) => invoke("saveSettings", [updates]),
      showInFolder: (relativePath) =>
        requestHost("showInFolder", [relativePath]),
      minimizeWindow: () => requestHost("minimizeWindow"),
      toggleMaximizeWindow: () =>
        requestHost("toggleMaximizeWindow"),
      closeWindow: () => requestHost("closeWindow"),
      onVaultChanged: (callback) => {
        if (typeof callback !== "function") {
          throw new TypeError("vault change callback must be a function");
        }
        subscribers.add(callback);
        openEventSource();
        let active = true;
        return () => {
          if (!active) {
            return;
          }
          active = false;
          subscribers.delete(callback);
          closeEventSourceIfIdle();
        };
      },
    };

    return {
      api: Object.freeze(api),
      settleHostRequest,
    };
  }

  const config = window.__SPACENOTES_BRIDGE_CONFIG__ || {};
  const host =
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.levilNotesHost;
  const bridge = createBridge(config, host, {
    fetch: window.fetch.bind(window),
    EventSource: window.EventSource,
  });
  window.levilNotes = bridge.api;
  window.__levilNotesHostResolve = (id, result) => {
    bridge.settleHostRequest(id, result, null);
  };
  window.__levilNotesHostReject = (id, message) => {
    bridge.settleHostRequest(id, null, message);
  };

  function reportDiagnostic(message) {
    if (host && host.postMessage) {
      host.postMessage({
        name: "bridgeDiagnostic",
        args: [String(message).slice(0, 2000)],
      });
    }
  }
  if (window.addEventListener) {
    window.addEventListener("error", (event) => {
      reportDiagnostic(
        "error: " +
          (event.message || "") +
          " @" +
          (event.filename || "") +
          ":" +
          (event.lineno || 0),
      );
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.stack || event.reason.message
          : event.reason;
      reportDiagnostic("rejection: " + String(reason));
    });
  }

  if (window.document && host && host.postMessage) {
    window.document.addEventListener(
      "mousedown",
      (event) => {
        if (
          event.button !== 0 ||
          !event.target.closest ||
          !event.target.closest(".topbar") ||
          event.target.closest("button, input, select, textarea, a")
        ) {
          return;
        }
        host.postMessage({ name: "beginWindowDrag", args: [] });
      },
      true,
    );
  }
})();
