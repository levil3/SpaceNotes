const fs = require("node:fs");
const path = require("node:path");

function decodeSwiftEscapes(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    index += 1;
    const escaped = value[index];
    const replacements = {
      n: "\n",
      r: "\r",
      t: "\t",
      '"': '"',
      "\\": "\\",
    };
    if (!(escaped in replacements)) {
      throw new Error(`Unsupported Swift escape: \\${escaped}`);
    }
    decoded += replacements[escaped];
  }
  return decoded;
}

const requiredFlows = [
  "transfer-create-write-read",
  "transfer-create-nested",
  "transfer-rename",
  "transfer-native-trash",
  "transfer-save-event",
  "transfer-search-index",
  "transfer-outline-index",
  "transfer-git-diff-stage",
  "transfer-git-commit",
];

function loadE2EContract() {
  const root = path.resolve(__dirname, "../..");
  const sourcePath = path.join(
    root,
    "macos",
    "Sources",
    "SpaceNotesMac",
    "E2ERunner.swift",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const marker = 'private static let script = """';
  const start = source.indexOf(marker);
  const end = source.lastIndexOf('\n    """');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unable to locate the embedded E2E JavaScript.");
  }
  const raw = source
    .slice(start + marker.length, end)
    .split("\n")
    .map((line) => line.replace(/^    /, ""))
    .join("\n");
  const script = decodeSwiftEscapes(raw);
  const flowNames = [...script.matchAll(/await runStep\("([^"]+)"/g)].map(
    (match) => match[1],
  );
  return { script, flowNames };
}

function verifyE2EContract() {
  const { script, flowNames } = loadE2EContract();
  new Function(`return (async () => {${script}\n})();`);
  if (!script.includes("step timed out after 20000ms")) {
    throw new Error("E2E steps do not have a bounded timeout.");
  }
  if (!script.includes('name: "e2eProgress"')) {
    throw new Error("E2E steps do not report progress to the native host.");
  }
  if (
    !script.includes("waiting:app-shell") ||
    !script.includes("app shell did not become ready within 30000ms")
  ) {
    throw new Error("E2E does not wait for the application shell to hydrate.");
  }
  if (flowNames.length !== 60) {
    throw new Error(`Expected 60 E2E flows, found ${flowNames.length}.`);
  }
  for (const name of requiredFlows) {
    if (!flowNames.includes(name)) {
      throw new Error(`Required E2E flow is missing: ${name}`);
    }
  }
  return { script, flowNames };
}

if (require.main === module) {
  verifyE2EContract();
  console.log("E2E embedded JavaScript parses after Swift escape decoding.");
}

module.exports = {
  decodeSwiftEscapes,
  loadE2EContract,
  requiredFlows,
  verifyE2EContract,
};
