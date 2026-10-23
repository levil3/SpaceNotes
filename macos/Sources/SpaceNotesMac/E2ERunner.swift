import Foundation
import WebKit

enum E2ERunner {
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
        webView.callAsyncJavaScript(
            script,
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case let .success(value):
                write(value: value, reportPath: reportPath, completion: completion)
            case let .failure(error):
                let report: [String: Any] = [
                    "status": "FAIL",
                    "total": 50,
                    "passed": 0,
                    "failures": [
                        [
                            "name": "runner",
                            "message": error.localizedDescription
                        ]
                    ]
                ]
                write(value: report, reportPath: reportPath, completion: completion)
            }
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
    const runStep = async (name, action) => {
      try {
        await action();
        results.push({ name, status: "PASS" });
      } catch (error) {
        failures.push({
          name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const flowBuilders = [
      async (index) => runStep(`files-open-${index}`, async () => {
        await clickRail("文件");
        const files = document.querySelectorAll(".file-row");
        expect(files.length > 0, "file rows are missing");
        const target = Array.from(files).find(
          (element) => element.title === "notes/second.md"
        ) || files[0];
        target.click();
        await sleep(180);
        expect(
          document.querySelector(".app-shell") !== null,
          "app shell disappeared"
        );
      }),
      async (index) => runStep(`search-open-${index}`, async () => {
        await clickRail("搜索");
        await setInput(
          'input[placeholder="搜索标题或正文"]',
          "blue"
        );
        expect(
          document.querySelectorAll(".search-result").length > 0,
          "search returned no visible results"
        );
        document.querySelector(".search-result").click();
        await sleep(180);
      }),
      async (index) => runStep(`outline-navigate-${index}`, async () => {
        await clickRail("大纲");
        expect(
          document.querySelectorAll(".outline-entry").length > 0,
          "outline entries are missing"
        );
        document.querySelector(".outline-entry").click();
        await sleep(100);
      }),
      async (index) => runStep(`tags-navigate-${index}`, async () => {
        await clickRail("标签");
        expect(
          document.querySelectorAll(".tag-row").length > 0,
          "tag rows are missing"
        );
        document.querySelector(".tag-row").click();
        await sleep(120);
      }),
      async (index) => runStep(`bridge-write-${index}`, async () => {
        const notePath = "notes/welcome.md";
        const original = await window.levilNotes.readNote(notePath);
        const updated = `${original.content}\\n\\nE2E ${index}\\n`;
        await window.levilNotes.writeNote(notePath, updated);
        const readBack = await window.levilNotes.readNote(notePath);
        expect(readBack.content === updated, "bridge write was not readable");
        await window.levilNotes.writeNote(notePath, original.content);
      }),
      async (index) => runStep(`git-panel-${index}`, async () => {
        await clickRail("Git");
        expect(
          document.querySelector(".panel-title-row") !== null,
          "Git panel title is missing"
        );
        const status = await window.levilNotes.gitStatus();
        expect(status.repository === true, "fixture Git repository is unavailable");
      }),
      async (index) => runStep(`settings-panel-${index}`, async () => {
        await clickRail("设置");
        expect(
          document.querySelector("[aria-label='显示隐藏目录和文件']") !== null,
          "settings controls are missing"
        );
      }),
      async (index) => runStep(`native-trash-${index}`, async () => {
        const created = await window.levilNotes.createNote(
          "",
          `e2e-disposable-${index}-${Date.now()}`
        );
        await sleep(120);
        await window.levilNotes.trashNote(created.path);
        await sleep(300);
        const snapshot = await window.levilNotes.getVaultSnapshot();
        expect(
          snapshot.files.every((file) => file.path !== created.path),
          "trashed note stayed in the index"
        );
      }),
      async (index) => runStep(`vault-image-${index}`, async () => {
        await clickRail("文件");
        const files = document.querySelectorAll(".file-row");
        const target = Array.from(files).find(
          (element) => element.title === "notes/welcome.md"
        );
        expect(target, "welcome note is missing");
        target.click();
        await sleep(800);
        const image = document.querySelector(
          ".editor-mount .milkdown img"
        );
        expect(image, "vault image element is missing");
        expect(
          image.src.startsWith("notes-asset://vault/"),
          `unexpected image URL ${image.src}`
        );
        expect(
          image.complete && image.naturalWidth > 0,
          "vault image did not load"
        );
      }),
    ];

    for (let index = 0; index < 50; index += 1) {
      await flowBuilders[index % flowBuilders.length](index);
    }
    return {
      status: failures.length === 0 ? "PASS" : "FAIL",
      total: results.length + failures.length,
      passed: results.length,
      failed: failures.length,
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
