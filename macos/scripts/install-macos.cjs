#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const APP_NAME = "Levil Notes.app";
const DEFAULT_APPLICATIONS_DIR = "/Applications";
const STAGING_PREFIX = `.${APP_NAME}.staging-`;
const PREVIOUS_PREFIX = `.${APP_NAME}.previous-`;

async function lstatIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function assertAppBundle(bundlePath, label) {
  let bundleStats;
  try {
    bundleStats = await fsp.stat(bundlePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label}不存在：${bundlePath}`);
    }
    throw error;
  }
  if (!bundleStats.isDirectory()) {
    throw new Error(`${label}不是 .app 目录：${bundlePath}`);
  }

  const infoPlist = path.join(bundlePath, "Contents", "Info.plist");
  let plistStats;
  try {
    plistStats = await fsp.stat(infoPlist);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label}缺少 Contents/Info.plist：${bundlePath}`);
    }
    throw error;
  }
  if (!plistStats.isFile()) {
    throw new Error(`${label}的 Contents/Info.plist 不是文件：${bundlePath}`);
  }
}

function commandFailure(action, error) {
  const stderr = error.stderr?.toString().trim();
  return new Error(stderr ? `${action}：${stderr}` : `${action}：${error.message}`, {
    cause: error,
  });
}

async function copyAppBundle(source, destination) {
  if (process.platform === "darwin") {
    try {
      execFileSync("/usr/bin/ditto", [source, destination], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      return;
    } catch (error) {
      throw commandFailure("复制应用失败", error);
    }
  }

  await fsp.cp(source, destination, {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
  });
}

async function removeTree(treePath) {
  await fsp.rm(treePath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function installAppBundle({
  sourceApp,
  applicationsDir = DEFAULT_APPLICATIONS_DIR,
  rename = fsp.rename,
  copyBundle = copyAppBundle,
} = {}) {
  if (!sourceApp) {
    throw new Error("缺少要安装的 .app 路径");
  }

  const source = await fsp.realpath(sourceApp);
  const installRoot = path.resolve(applicationsDir);
  const target = path.join(installRoot, APP_NAME);

  await assertAppBundle(source, "源应用");
  if (source === target) {
    throw new Error(`源应用已经是固定安装位置：${target}`);
  }

  await fsp.mkdir(installRoot, { recursive: true });
  const targetStats = await lstatIfExists(target);
  if (targetStats && !targetStats.isDirectory()) {
    throw new Error(`固定安装位置不是 .app 目录，已停止以免覆盖文件：${target}`);
  }

  const stagingRoot = await fsp.mkdtemp(
    path.join(installRoot, STAGING_PREFIX),
  );
  const stagedApp = path.join(stagingRoot, APP_NAME);
  let previousRoot = null;
  let previousApp = null;
  let primaryError = null;

  try {
    await copyBundle(source, stagedApp);
    await assertAppBundle(stagedApp, "复制后的应用");

    if (targetStats) {
      previousRoot = await fsp.mkdtemp(
        path.join(installRoot, PREVIOUS_PREFIX),
      );
      previousApp = path.join(previousRoot, APP_NAME);
      await rename(target, previousApp);

      try {
        await rename(stagedApp, target);
      } catch (error) {
        try {
          await rename(previousApp, target);
          await removeTree(previousRoot);
          previousRoot = null;
          previousApp = null;
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `更新失败，且无法恢复旧版本；旧版本保留在：${previousApp}`,
          );
        }
        throw error;
      }
    } else {
      await rename(stagedApp, target);
    }

    if (previousRoot) {
      await removeTree(previousRoot);
      previousRoot = null;
      previousApp = null;
    }

    return target;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await removeTree(stagingRoot);
    } catch (cleanupError) {
      if (!primaryError) {
        throw new AggregateError(
          [cleanupError],
          `应用已安装，但临时安装目录未清理：${stagingRoot}`,
        );
      }
    }

    if (previousRoot) {
      const currentTarget = await lstatIfExists(target);
      if (!currentTarget && previousApp) {
        try {
          await rename(previousApp, target);
        } catch {
          // Keep the hidden previous bundle for manual recovery.
        }
      }

      if (await lstatIfExists(target)) {
        try {
          await removeTree(previousRoot);
        } catch (cleanupError) {
          if (!primaryError) {
            throw new AggregateError(
              [cleanupError],
              `应用已更新，但旧版本临时目录未清理：${previousRoot}`,
            );
          }
        }
      }
    }
  }
}

function printUsage() {
  console.log(
    [
      `用法：node ${path.basename(__filename)} <Levil Notes.app|dmg> [--applications-dir <目录>]`,
      "",
      `默认固定更新到：${DEFAULT_APPLICATIONS_DIR}/${APP_NAME}`,
      "重复执行会替换同一个应用，不创建版本目录或长期备份。",
    ].join("\n"),
  );
}

function parseArguments(argv) {
  let input = "";
  let applicationsDir = DEFAULT_APPLICATIONS_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--applications-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--applications-dir 需要目录参数");
      }
      applicationsDir = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`未知参数：${argument}`);
    } else if (input) {
      throw new Error(`只能指定一个 .app 或 .dmg：${argument}`);
    } else {
      input = argument;
    }
  }

  if (!input) {
    throw new Error("缺少 .app 或 .dmg 路径");
  }
  return { input, applicationsDir };
}

function mountDmg(dmgPath) {
  const mountPoint = fs.mkdtempSync(
    path.join(os.tmpdir(), "levil-notes-dmg-"),
  );
  const removeMountPoint = () => {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  };

  try {
    execFileSync(
      "/usr/bin/hdiutil",
      [
        "attach",
        "-quiet",
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mountPoint,
        dmgPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    removeMountPoint();
    throw commandFailure("挂载 DMG 失败", error);
  }

  return {
    appPath: path.join(mountPoint, APP_NAME),
    detach() {
      try {
        execFileSync(
          "/usr/bin/hdiutil",
          ["detach", mountPoint, "-quiet"],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        removeMountPoint();
      } catch (error) {
        throw commandFailure(
          `卸载 DMG 失败，挂载点仍保留在 ${mountPoint}`,
          error,
        );
      }
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  if (process.platform !== "darwin") {
    throw new Error("macOS 安装器只能在 macOS 上运行");
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return null;
  }

  const { input, applicationsDir } = parseArguments(argv);
  const sourcePath = path.resolve(input);
  const sourceStats = await fsp.stat(sourcePath);
  let mountedDmg = null;

  try {
    let sourceApp = sourcePath;
    if (sourceStats.isFile() && sourcePath.toLowerCase().endsWith(".dmg")) {
      mountedDmg = mountDmg(sourcePath);
      sourceApp = mountedDmg.appPath;
    } else if (
      !sourceStats.isDirectory() ||
      !sourcePath.toLowerCase().endsWith(".app")
    ) {
      throw new Error(`安装源必须是 .app 目录或 .dmg 文件：${sourcePath}`);
    }

    const installedPath = await installAppBundle({
      sourceApp,
      applicationsDir,
    });
    console.log(`已更新固定安装位置：${installedPath}`);
    return installedPath;
  } finally {
    if (mountedDmg) {
      mountedDmg.detach();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`安装失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_NAME,
  DEFAULT_APPLICATIONS_DIR,
  installAppBundle,
  parseArguments,
};
