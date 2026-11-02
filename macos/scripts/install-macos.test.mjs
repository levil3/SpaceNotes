import { createRequire } from "node:module";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  APP_NAME,
  DEFAULT_APPLICATIONS_DIR,
  installAppBundle,
  parseArguments,
} = require("./install-macos.cjs");

const temporaryRoots = [];

async function createWorkspace() {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), "levil-notes-install-test-"),
  );
  temporaryRoots.push(root);
  const applicationsDir = path.join(root, "Applications");
  const sourcesDir = path.join(root, "sources");
  await fsp.mkdir(applicationsDir, { recursive: true });
  await fsp.mkdir(sourcesDir, { recursive: true });
  return { root, applicationsDir, sourcesDir };
}

async function createAppBundle(parent, name, marker) {
  const bundle = path.join(parent, name);
  const contents = path.join(bundle, "Contents");
  await fsp.mkdir(contents, { recursive: true });
  await fsp.writeFile(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0"?><plist><dict><key>TestMarker</key><string>${marker}</string></dict></plist>`,
  );
  await fsp.writeFile(path.join(contents, "version.txt"), marker);
  return bundle;
}

async function readMarker(appPath) {
  return fsp.readFile(path.join(appPath, "Contents", "version.txt"), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fsp.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("macOS fixed-path installer", () => {
  it("uses the fixed Applications path and default CLI directory", () => {
    expect(APP_NAME).toBe("Levil Notes.app");
    expect(DEFAULT_APPLICATIONS_DIR).toBe("/Applications");
    expect(parseArguments(["/tmp/Levil Notes.dmg"])).toEqual({
      input: "/tmp/Levil Notes.dmg",
      applicationsDir: "/Applications",
    });
  });

  it("installs a bundle once at the fixed application path", async () => {
    const { applicationsDir, sourcesDir } = await createWorkspace();
    const source = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.21-arm64.app",
      "first",
    );

    const installedPath = await installAppBundle({
      sourceApp: source,
      applicationsDir,
    });

    expect(installedPath).toBe(path.join(applicationsDir, APP_NAME));
    expect(await readMarker(installedPath)).toBe("first");
    expect(await fsp.readdir(applicationsDir)).toEqual([APP_NAME]);
  });

  it("updates the existing app without creating another version", async () => {
    const { applicationsDir, sourcesDir } = await createWorkspace();
    const firstSource = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.21-arm64.app",
      "first",
    );
    const secondSource = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.22-arm64.app",
      "second",
    );

    await installAppBundle({
      sourceApp: firstSource,
      applicationsDir,
    });
    const installedPath = await installAppBundle({
      sourceApp: secondSource,
      applicationsDir,
    });

    expect(await readMarker(installedPath)).toBe("second");
    expect(await fsp.readdir(applicationsDir)).toEqual([APP_NAME]);
  });

  it("restores the previous app when swapping in the update fails", async () => {
    const { applicationsDir, sourcesDir } = await createWorkspace();
    const firstSource = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.21-arm64.app",
      "first",
    );
    const secondSource = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.22-arm64.app",
      "second",
    );
    const target = path.join(applicationsDir, APP_NAME);

    await installAppBundle({
      sourceApp: firstSource,
      applicationsDir,
    });

    let failNextSwap = true;
    const failOnceAtTarget = async (source, destination) => {
      if (destination === target && failNextSwap) {
        failNextSwap = false;
        throw new Error("simulated swap failure");
      }
      return fsp.rename(source, destination);
    };

    await expect(
      installAppBundle({
        sourceApp: secondSource,
        applicationsDir,
        rename: failOnceAtTarget,
      }),
    ).rejects.toThrow("simulated swap failure");

    expect(await readMarker(target)).toBe("first");
    expect(await fsp.readdir(applicationsDir)).toEqual([APP_NAME]);
  });

  it("does not overwrite the installed app with an invalid source", async () => {
    const { applicationsDir, sourcesDir } = await createWorkspace();
    const firstSource = await createAppBundle(
      sourcesDir,
      "Levil Notes 0.1.21-arm64.app",
      "first",
    );
    const invalidSource = path.join(sourcesDir, "not-an-app");
    await fsp.mkdir(invalidSource);

    const installedPath = await installAppBundle({
      sourceApp: firstSource,
      applicationsDir,
    });

    await expect(
      installAppBundle({
        sourceApp: invalidSource,
        applicationsDir,
      }),
    ).rejects.toThrow("缺少 Contents/Info.plist");

    expect(await readMarker(installedPath)).toBe("first");
    expect(await fsp.readdir(applicationsDir)).toEqual([APP_NAME]);
  });
});
