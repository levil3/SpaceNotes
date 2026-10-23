const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");

function parseStat(stdout) {
  const parsed = JSON.parse(String(stdout || "").trim() || "{}");
  return {
    dev: Number(parsed.dev),
    ino: Number(parsed.ino),
    size: Number(parsed.size),
    mtimeMs: Number(parsed.mtimeMs),
    isFile: () => true,
  };
}

function createNativeFileOperations(helperPath) {
  return {
    read(root, relativePath) {
      return new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["read", root, relativePath],
          {
            encoding: null,
            maxBuffer: 64 * 1024 * 1024,
          },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(stdout);
          },
        );
      });
    },

    stat(root, relativePath) {
      return new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["stat", root, relativePath],
          { encoding: "utf8" },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            try {
              resolve(parseStat(stdout));
            } catch (parseError) {
              reject(parseError);
            }
          },
        );
      });
    },

    write(root, relativePath, content, mode) {
      return new Promise((resolve, reject) => {
        const child = spawn(
          helperPath,
          ["write", root, relativePath, mode],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code !== 0) {
            reject(new Error(stderr.trim() || `file helper exited ${code}`));
            return;
          }
          try {
            resolve(parseStat(stdout));
          } catch (error) {
            reject(error);
          }
        });
        child.stdin.end(content);
      });
    },

    rename(root, sourceRelative, destinationRelative) {
      return new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["rename", root, sourceRelative, destinationRelative],
          { encoding: "utf8" },
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
        );
      });
    },

    mkdir(root, relativePath) {
      return new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["mkdir", root, relativePath],
          { encoding: "utf8" },
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
        );
      });
    },
  };
}

function requireNativeFileOperations(helperPath) {
  if (!helperPath) {
    throw new Error("macOS 文件安全组件路径未配置。");
  }
  let stat;
  try {
    stat = fs.statSync(helperPath);
  } catch {
    throw new Error(`macOS 文件安全组件缺失：${helperPath}`);
  }
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error(`macOS 文件安全组件不可执行：${helperPath}`);
  }
  return createNativeFileOperations(helperPath);
}

module.exports = {
  createNativeFileOperations,
  parseStat,
  requireNativeFileOperations,
};
