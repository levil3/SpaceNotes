import Foundation
import WebKit

enum E2ERunner {
    private final class CompletionGate {
        private let lock = NSLock()
        private var completed = false

        func finish(_ action: () -> Void) {
            lock.lock()
            guard !completed else {
                lock.unlock()
                return
            }
            completed = true
            lock.unlock()
            action()
        }
    }

    static var reportPath: String? {
        guard
            let index = CommandLine.arguments.firstIndex(of: "--e2e-report"),
            CommandLine.arguments.indices.contains(index + 1)
        else {
            return nil
        }
        return CommandLine.arguments[index + 1]
    }

    static func run(
        webView: WKWebView,
        reportPath: String,
        completion: @escaping (String) -> Void
    ) {
        let gate = CompletionGate()
        let timeout = DispatchWorkItem {
            finishOnce(
                gate: gate,
                value: [
                    "status": "NOT CERTIFIED",
                    "conclusion": "NOT CERTIFIED",
                    "total": 0,
                    "passed": 0,
                    "failed": 1,
                    "results": [],
                    "failures": [
                        [
                            "name": "runner-timeout",
                            "message": "E2E did not complete within 180 seconds."
                        ]
                    ]
                ],
                reportPath: reportPath,
                completion: completion
            )
        }
        DispatchQueue.main.asyncAfter(
            deadline: .now() + 180,
            execute: timeout
        )
        webView.callAsyncJavaScript(
            script,
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            timeout.cancel()
            switch result {
            case let .success(value):
                finishOnce(
                    gate: gate,
                    value: value,
                    reportPath: reportPath,
                    completion: completion
                )
            case let .failure(error):
                let report: [String: Any] = [
                    "status": "NOT CERTIFIED",
                    "conclusion": "NOT CERTIFIED",
                    "total": 0,
                    "passed": 0,
                    "failed": 1,
                    "results": [],
                    "failures": [
                        [
                            "name": "runner",
                            "message": error.localizedDescription
                        ]
                    ]
                ]
                finishOnce(
                    gate: gate,
                    value: report,
                    reportPath: reportPath,
                    completion: completion
                )
            }
        }
    }

    private static func finishOnce(
        gate: CompletionGate,
        value: Any,
        reportPath: String,
        completion: @escaping (String) -> Void
    ) {
        gate.finish {
            write(value: value, reportPath: reportPath, completion: completion)
        }
    }

    private static func write(
        value: Any,
        reportPath: String,
        completion: (String) -> Void
    ) {
        do {
            let data = try JSONSerialization.data(
                withJSONObject: value,
                options: [.prettyPrinted, .sortedKeys]
            )
            let directory = URL(fileURLWithPath: reportPath)
                .deletingLastPathComponent()
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            try data.write(to: URL(fileURLWithPath: reportPath), options: .atomic)
            let text = String(data: data, encoding: .utf8) ?? "{}"
            completion(text)
        } catch {
            completion("E2E report write failed: \(error.localizedDescription)")
        }
    }

    private static let script = """
    const sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const results = [];
    const failures = [];
    let aborted = false;
    const redact = (value) => {
      let text = String(value);
      const token =
        window.__SPACENOTES_BRIDGE_CONFIG__ &&
        window.__SPACENOTES_BRIDGE_CONFIG__.token;
      if (token) {
        text = text.split(String(token)).join("[redacted]");
      }
      return text
        .replace(/(token=)[^\\s&]+/gi, "$1[redacted]")
        .replace(/(Bearer\\s+)\\S+/gi, "$1[redacted]");
    };
    const reportProgress = (message) => {
      try {
        const host =
          window.webkit &&
          window.webkit.messageHandlers &&
          window.webkit.messageHandlers.levilNotesHost;
        if (host && typeof host.postMessage === "function") {
          host.postMessage({
            name: "e2eProgress",
            args: [redact(message).slice(0, 1000)],
          });
        }
      } catch {
        // Progress reporting must not change the certification outcome.
      }
    };
    const runStep = async (name, action) => {
      if (aborted) {
        return;
      }
      const startedAt = Date.now();
      reportProgress(`start:${name}`);
      let timeoutId = null;
      try {
        await Promise.race([
          Promise.resolve().then(action),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`step timed out after 20000ms: ${name}`)),
              20000,
            );
          }),
        ]);
        const durationMs = Date.now() - startedAt;
        results.push({ name, status: "PASS", durationMs });
        reportProgress(`pass:${name}`);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const message = redact(rawMessage);
        failures.push({ name, message, durationMs });
        reportProgress(`fail:${name}:${message}`);
        if (message.includes("step timed out after")) {
          aborted = true;
        }
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };
    const requireElement = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`missing element ${selector}`);
      }
      return element;
    };
    const clickRail = async (label) => {
      const button = Array.from(
        document.querySelectorAll(".rail-button")
      ).find((candidate) =>
        (candidate.getAttribute("aria-label") || "").startsWith(label)
      );
      if (!button) {
        throw new Error(`missing rail ${label}`);
      }
      button.click();
      await sleep(140);
    };
    const setInput = async (selector, value) => {
      const input = requireElement(selector);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(420);
    };
    const expect = (condition, message) => {
      if (!condition) {
        throw new Error(message);
      }
    };
    const expectReject = async (promise, message) => {
      try {
        await promise;
      } catch {
        return;
      }
      throw new Error(message);
    };
    const waitFor = async (predicate, message, timeout = 4000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) {
          return value;
        }
        await sleep(60);
      }
      throw new Error(message);
    };
    const clickButton = async (label) => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.getAttribute("aria-label") === label
      );
      expect(button, `missing button ${label}`);
      button.click();
      await sleep(160);
    };
    const openFile = async (path) => {
      await clickRail("文件");
      const files = document.querySelectorAll(".file-row");
      const target = Array.from(files).find(
        (element) => element.title === path
      );
      expect(target, `missing file ${path}`);
      target.click();
      await sleep(260);
    };
    const tabButton = (label) =>
      Array.from(document.querySelectorAll(".git-tabs button")).find(
        (candidate) => candidate.textContent.trim().startsWith(label)
      );

    await runStep("shell-layout", async () => {
      expect(requireElement(".app-shell"), "app shell is missing");
      expect(requireElement(".topbar"), "topbar is missing");
      expect(requireElement(".app-body"), "app body is missing");
    });
    await runStep("activity-rail-contract", async () => {
      const rail = requireElement(".activity-rail");
      expect(rail.getAttribute("aria-label") === "左侧导航", "rail label changed");
      expect(rail.querySelectorAll(".rail-button").length >= 7, "rail actions are missing");
    });
    await runStep("file-panel-title", async () => {
      await clickRail("文件");
      expect(
        requireElement(".panel-kicker").textContent.trim() === "笔记库",
        "file panel title changed"
      );
    });
    await runStep("topbar-vault-menu", async () => {
      expect(requireElement("[aria-label='打开笔记库菜单']"), "vault menu is missing");
    });
    await runStep("note-tab-strip", async () => {
      expect(
        requireElement(".tab-strip").getAttribute("role") === "tablist",
        "tab strip contract changed"
      );
    });
    await runStep("window-control-contract", async () => {
      expect(
        document.querySelectorAll(".window-controls > button").length === 3,
        "window controls changed"
      );
    });
    await runStep("statusbar-contract", async () => {
      expect(requireElement(".statusbar"), "status bar is missing");
      expect(requireElement(".save-status"), "save status is missing");
    });
    await runStep("sidebar-collapse-toggle", async () => {
      const shell = requireElement(".app-shell");
      const initial = shell.classList.contains("sidebar-collapsed");
      await clickButton(initial ? "展开侧栏" : "收起侧栏");
      expect(
        shell.classList.contains("sidebar-collapsed") !== initial,
        "sidebar did not collapse"
      );
      await clickButton(initial ? "收起侧栏" : "展开侧栏");
      expect(
        shell.classList.contains("sidebar-collapsed") === initial,
        "sidebar did not restore"
      );
    });
    await runStep("rail-navigation-cycle", async () => {
      for (const label of ["大纲", "搜索", "标签", "反向链接", "Git", "设置"]) {
        await clickRail(label);
        expect(
          document.querySelector(".rail-button.active") !== null,
          `rail did not activate ${label}`
        );
      }
      await clickRail("文件");
    });
    await runStep("sidebar-resize-contract", async () => {
      expect(
        document.querySelector("[aria-label='调整左侧栏宽度']"),
        "sidebar resize handle is missing"
      );
    });
    await runStep("file-list-populated", async () => {
      await clickRail("文件");
      expect(document.querySelectorAll(".file-row").length > 0, "file list is empty");
    });
    await runStep("file-filter-focus", async () => {
      const input = requireElement('input[placeholder="按标题或路径筛选"]');
      input.focus();
      expect(document.activeElement === input, "file filter cannot focus");
    });
    await runStep("file-filter-welcome", async () => {
      await clickRail("文件");
      await setInput('input[placeholder="按标题或路径筛选"]', "welcome");
      const rows = Array.from(document.querySelectorAll(".file-row"));
      expect(rows.length > 0, "welcome filter returned no rows");
      expect(
        rows.every((row) => row.title.toLowerCase().includes("welcome")),
        "welcome filter returned unrelated rows"
      );
    });
    await runStep("file-filter-path", async () => {
      await setInput('input[placeholder="按标题或路径筛选"]', "second");
      const rows = Array.from(document.querySelectorAll(".file-row"));
      expect(rows.length > 0, "path filter returned no rows");
      expect(
        rows.some((row) => row.title === "notes/second.md"),
        "path filter missed notes/second.md"
      );
    });
    await runStep("file-filter-clear", async () => {
      await setInput('input[placeholder="按标题或路径筛选"]', "");
      expect(document.querySelectorAll(".file-row").length > 0, "clearing filter lost files");
    });
    await runStep("file-open-welcome", async () => {
      await openFile("notes/welcome.md");
      expect(requireElement(".editor-breadcrumb"), "editor breadcrumb is missing");
      expect(
        document.querySelector(".note-tab[aria-selected='true']"),
        "welcome note did not become active"
      );
    });
    await runStep("file-open-second", async () => {
      await openFile("notes/second.md");
      expect(
        document.querySelector(".note-tab[aria-selected='true']"),
        "second note did not become active"
      );
    });
    await runStep("file-count-footer", async () => {
      await clickRail("文件");
      expect(
        requireElement(".panel-footer-note").textContent.includes("篇 Markdown"),
        "file count footer changed"
      );
    });
    await runStep("search-panel", async () => {
      await clickRail("搜索");
      expect(requireElement('input[placeholder="搜索标题或正文"]'), "search box is missing");
    });
    await runStep("search-query-results", async () => {
      await setInput('input[placeholder="搜索标题或正文"]', "blue");
      await waitFor(
        () => document.querySelectorAll(".search-result").length > 0,
        "search returned no results"
      );
    });
    await runStep("search-result-metadata", async () => {
      expect(document.querySelector(".result-path"), "search result path is missing");
      expect(document.querySelector(".result-snippet"), "search result snippet is missing");
    });
    await runStep("search-scope-controls", async () => {
      expect(
        document.querySelectorAll("[aria-label='搜索范围'] button").length === 3,
        "search scope controls changed"
      );
    });
    await runStep("search-mode-control", async () => {
      expect(
        requireElement("select[aria-label='搜索匹配方式']").options.length === 2,
        "search mode control changed"
      );
    });
    await runStep("search-open-result", async () => {
      const result = await waitFor(
        () => document.querySelector(".search-result"),
        "search result did not appear"
      );
      result.click();
      await sleep(220);
      expect(
        document.querySelector(".note-tab[aria-selected='true']"),
        "search result did not open a note"
      );
    });
    await runStep("search-empty-state", async () => {
      await clickRail("搜索");
      await setInput(
        'input[placeholder="搜索标题或正文"]',
        "no-such-e2e-content-9f83d1"
      );
      await waitFor(
        () =>
          requireElement(".search-results").textContent.includes(
            "没有找到匹配内容"
          ),
        "search empty state is missing"
      );
    });
    await runStep("outline-panel", async () => {
      await clickRail("大纲");
      expect(requireElement(".outline-list"), "outline panel is missing");
    });
    await runStep("outline-entries", async () => {
      expect(document.querySelectorAll(".outline-entry").length > 0, "outline is empty");
    });
    await runStep("outline-click", async () => {
      document.querySelector(".outline-entry").click();
      await sleep(140);
      expect(requireElement(".editor-mount"), "outline navigation removed the editor");
    });
    await runStep("tags-panel", async () => {
      await clickRail("标签");
      expect(requireElement(".tag-list"), "tag panel is missing");
    });
    await runStep("tags-row-click", async () => {
      expect(document.querySelectorAll(".tag-row").length > 0, "tag list is empty");
      document.querySelector(".tag-row").click();
      await sleep(180);
    });
    await runStep("backlinks-panel", async () => {
      await clickRail("反向链接");
      expect(requireElement(".panel-title-row"), "backlinks panel is missing");
    });
    await runStep("backlinks-content", async () => {
      expect(requireElement(".outline-note-title"), "backlinks note title is missing");
    });
    await runStep("panel-metadata", async () => {
      await clickRail("标签");
      expect(requireElement(".panel-meta").textContent.length > 0, "panel metadata is empty");
    });
    await runStep("git-panel", async () => {
      await clickRail("Git");
      expect(requireElement(".git-panel"), "Git panel is missing");
    });
    await runStep("git-branch-card", async () => {
      expect(requireElement(".git-branch-card"), "Git branch card is missing");
    });
    await runStep("git-tabs", async () => {
      expect(
        document.querySelectorAll(".git-tabs > button").length === 3,
        "Git tabs changed"
      );
    });
    await runStep("git-changes", async () => {
      expect(requireElement(".commit-box"), "Git commit controls are missing");
    });
    await runStep("git-history-tab", async () => {
      const button = tabButton("历史");
      expect(button, "Git history tab is missing");
      button.click();
      await sleep(180);
      expect(requireElement(".git-history-list"), "Git history list is missing");
    });
    await runStep("git-ignore-tab", async () => {
      const button = tabButton("忽略");
      expect(button, "Git ignore tab is missing");
      button.click();
      await sleep(180);
      expect(requireElement(".git-ignore-hint"), "Git ignore guidance is missing");
    });
    await runStep("git-refresh-control", async () => {
      expect(
        document.querySelector("[aria-label='刷新 Git 状态']"),
        "Git refresh control is missing"
      );
    });
    await runStep("settings-panel", async () => {
      await clickRail("设置");
      expect(requireElement(".settings-panel"), "settings panel is missing");
    });
    await runStep("settings-theme-modes", async () => {
      expect(
        document.querySelectorAll(".settings-panel .segmented.three-up button").length === 3,
        "theme modes changed"
      );
    });
    await runStep("settings-hidden-toggle", async () => {
      expect(
        document.querySelector("[aria-label='显示隐藏目录和文件']"),
        "hidden file toggle is missing"
      );
    });
    await runStep("settings-presets", async () => {
      expect(
        document.querySelectorAll(".theme-preset").length >= 3,
        "theme presets are missing"
      );
    });
    await runStep("settings-colors", async () => {
      expect(
        document.querySelectorAll(".settings-panel input[type='color']").length === 3,
        "color settings changed"
      );
    });
    await runStep("settings-ranges", async () => {
      expect(
        document.querySelectorAll(".settings-panel input[type='range']").length === 2,
        "range settings changed"
      );
    });
    await runStep("settings-reset", async () => {
      expect(
        document.querySelector("[aria-label='恢复默认外观']"),
        "settings reset control is missing"
      );
    });
    await runStep("vault-image", async () => {
      await openFile("notes/welcome.md");
      await sleep(800);
      const image = document.querySelector(".editor-mount .milkdown img");
      expect(image, "vault image element is missing");
      expect(
        image.src.startsWith("notes-asset://vault/"),
        `unexpected image URL ${image.src}`
      );
      expect(
        image.complete && image.naturalWidth > 0,
        "vault image did not load"
      );
    });
    await runStep("editor-view-toggle", async () => {
      const toggle =
        document.querySelector("[aria-label='切换到阅读模式']") ||
        document.querySelector("[aria-label='切换到编辑模式']");
      expect(toggle, "editor view toggle is missing");
      const before = toggle.getAttribute("aria-label");
      toggle.click();
      await sleep(180);
      const after =
        document.querySelector("[aria-label='切换到阅读模式']") ||
        document.querySelector("[aria-label='切换到编辑模式']");
      expect(after.getAttribute("aria-label") !== before, "view mode did not toggle");
    });
    await runStep("editor-more-menu", async () => {
      await clickButton("更多");
      expect(
        document.querySelector("[aria-label='笔记操作']"),
        "editor action menu did not open"
      );
    });
    await runStep("top-level-navigation-policy", async () => {
      const trustedURL = location.href;
      const attemptNavigation = async (target) => {
        try {
          location.href = target;
        } catch {
          return;
        }
        await sleep(250);
      };
      await attemptNavigation("notes-asset://vault/evil.svg");
      expect(
        location.href === trustedURL,
        "notes-asset document replaced the trusted application shell"
      );
      await attemptNavigation(
        `${location.origin}/assets?target=evil.svg&note=welcome.md`
      );
      expect(
        location.href === trustedURL,
        "sidecar asset document replaced the trusted application shell"
      );
      expect(
        window.__SPACENOTES_BRIDGE_CONFIG__.token.length > 0,
        "trusted application shell lost the sidecar bridge"
      );
    });
    await runStep("transfer-create-write-read", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-transfer-${Date.now()}`
      );
      const content = "# Transfer\\n\\nSide effect marker: amber-river.\\n";
      await window.levilNotes.writeNote(created.path, content);
      const readBack = await window.levilNotes.readNote(created.path);
      expect(readBack.content === content, "written note did not round-trip");
    });
    await runStep("transfer-create-nested", async () => {
      const parent = `e2e/nested-${Date.now()}`;
      const title = "Created below nested directory";
      const created = await window.levilNotes.createNote(parent, title);
      expect(
        created.path === `${parent}/${title}.md`,
        "nested note path did not match the requested directory"
      );
      const readBack = await window.levilNotes.readNote(created.path);
      expect(
        readBack.content.startsWith(`# ${title}`),
        "nested note content was not created"
      );
    });
    await runStep("transfer-rename", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-rename-source-${Date.now()}`
      );
      const renamed = await window.levilNotes.renameNote(
        created.path,
        `e2e-renamed-${Date.now()}`
      );
      expect(renamed.path !== created.path, "rename did not change the path");
      await expectReject(
        window.levilNotes.readNote(created.path),
        "old note path remained readable after rename"
      );
      const readBack = await window.levilNotes.readNote(renamed.path);
      expect(readBack.content.includes("#"), "renamed note lost its content");
    });
    await runStep("transfer-native-trash", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-trash-${Date.now()}`
      );
      await window.levilNotes.trashNote(created.path);
      await expectReject(
        window.levilNotes.readNote(created.path),
        "trashed note remained readable"
      );
      const snapshot = await window.levilNotes.getVaultSnapshot();
      expect(
        snapshot.files.every((file) => file.path !== created.path),
        "trashed note remained in the vault index"
      );
    });
    await runStep("transfer-save-event", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-event-${Date.now()}`
      );
      let savedSnapshot = null;
      const unsubscribe = window.levilNotes.onVaultChanged((snapshot) => {
        if (snapshot.reason === "saved") {
          savedSnapshot = snapshot;
        }
      });
      await sleep(150);
      await window.levilNotes.writeNote(
        created.path,
        "# Event\\n\\nSaved event payload.\\n"
      );
      await waitFor(
        () => savedSnapshot,
        "saved vault event did not arrive"
      );
      unsubscribe();
      expect(
        savedSnapshot.files.some((file) => file.path === created.path),
        "saved event did not include the updated note"
      );
    });
    await runStep("transfer-search-index", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-search-${Date.now()}`
      );
      await window.levilNotes.writeNote(
        created.path,
        "# Search\\n\\nUnique indexed marker: cobalt-foxglove.\\n"
      );
      const matches = await window.levilNotes.search(
        "cobalt-foxglove",
        "all",
        "exact"
      );
      expect(
        matches.some((match) => match.path === created.path),
        "search index did not include the written note"
      );
    });
    await runStep("transfer-outline-index", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-outline-${Date.now()}`
      );
      await window.levilNotes.writeNote(
        created.path,
        "# Outline Root\\n\\n## Outline Child\\n"
      );
      const outline = await window.levilNotes.getOutline(created.path);
      expect(outline.length === 2, "outline index did not include headings");
      expect(
        outline[1].text === "Outline Child",
        "outline heading text changed"
      );
    });
    await runStep("transfer-git-diff-stage", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-git-diff-${Date.now()}`
      );
      await window.levilNotes.writeNote(
        created.path,
        "# Git\\n\\nDiff marker: silver-cedar.\\n"
      );
      const diff = await window.levilNotes.gitDiff(created.path);
      expect(diff.includes("silver-cedar"), "Git diff omitted note content");
      const status = await window.levilNotes.gitStage(
        [created.path],
        false
      );
      expect(
        status.changes.some(
          (change) => change.path === created.path && change.staged
        ),
        "Git staging did not mark the note as staged"
      );
      await window.levilNotes.gitStage([created.path], true);
    });
    await runStep("transfer-git-commit", async () => {
      const created = await window.levilNotes.createNote(
        "",
        `e2e-git-commit-${Date.now()}`
      );
      const message = `test: certify transfer ${Date.now()}`;
      await window.levilNotes.writeNote(
        created.path,
        "# Commit\\n\\nCommitted through the macOS bridge.\\n"
      );
      await window.levilNotes.gitStage([created.path], false);
      const committed = await window.levilNotes.gitCommit(
        message,
        [created.path]
      );
      expect(
        committed.output.includes("certify transfer"),
        "Git commit output omitted the commit subject"
      );
      const history = await window.levilNotes.gitLog();
      expect(
        history.some((entry) => entry.subject === message),
        "Git history did not include the bridge-created commit"
      );
    });
    return {
      status: failures.length === 0 ? "CERTIFIED" : "NOT CERTIFIED",
      conclusion: failures.length === 0 ? "CERTIFIED" : "NOT CERTIFIED",
      flowContractVersion: 1,
      requiredFlows: 60,
      total: results.length + failures.length,
      passed: results.length,
      failed: failures.length,
      independentFlows: results.length + failures.length,
      results,
      failures,
      environment: {
        userAgent: navigator.userAgent,
        location: location.origin,
        timestamp: new Date().toISOString(),
      },
    };
    """
}
