const { execFileSync } = require("node:child_process");
const path = require("node:path");

if (process.platform === "darwin") {
  execFileSync(
    "bash",
    [path.resolve(__dirname, "../native/build-fs-helper.sh")],
    { stdio: "inherit" },
  );
}
