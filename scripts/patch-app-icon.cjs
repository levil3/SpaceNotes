const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const rceditPath = path.join(projectRoot, "resources", "tools", "rcedit-x64.exe");
const iconPath = path.join(projectRoot, "resources", "icon.ico");

/**
 * electron-builder 在禁用内部可执行文件编辑后，不会自动写入 Windows 图标。
 * 这里在 NSIS 封装前直接修改主程序，让安装后的任务栏和快捷方式使用 SpaceNotes 图标。
 */
module.exports = async function patchAppIcon(context) {
  const executablePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  const result = spawnSync(rceditPath, [executablePath, "--set-icon", iconPath], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to patch Windows app icon: ${result.stderr || result.stdout}`,
    );
  }
};
