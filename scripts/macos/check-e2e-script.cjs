const fs = require("node:fs");
const path = require("node:path");

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

const script = decodeSwiftEscapes(raw);
new Function(`return (async () => {${script}\n})();`);
console.log("E2E embedded JavaScript parses after Swift escape decoding.");
