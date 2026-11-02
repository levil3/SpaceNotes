import { describe, expect, it } from "vitest";
import { planExternalReload } from "./externalReload";

const DISK_STAMP = { path: "notes/today.md", modifiedAt: 1000 };
const ON_DISK = { modifiedAt: 2000 };

const base = {
  reason: "external-change",
  activePath: "notes/today.md",
  activeFile: ON_DISK,
  loaded: DISK_STAMP,
  hasUnsavedEdits: false,
  isInDirectoryTransition: false,
};

describe("planExternalReload", () => {
  it("reloads the open note when another program changed it on disk", () => {
    expect(planExternalReload(base)).toEqual({
      kind: "reload",
      path: "notes/today.md",
      modifiedAt: 2000,
    });
  });

  it("ignores the watcher echoing a save this application wrote itself", () => {
    expect(
      planExternalReload({
        ...base,
        loaded: { path: "notes/today.md", modifiedAt: 2000 },
      }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores changes elsewhere in the vault", () => {
    expect(
      planExternalReload({
        ...base,
        loaded: { path: "notes/other.md", modifiedAt: 7 },
        activeFile: null,
      }),
    ).toEqual({ kind: "ignore" });
  });

  it("keeps unsaved edits instead of overwriting them", () => {
    expect(planExternalReload({ ...base, hasUnsavedEdits: true })).toEqual({
      kind: "conflict",
      path: "notes/today.md",
    });
  });

  it("ignores snapshots the application wrote itself", () => {
    for (const reason of [
      "saved",
      "created",
      "renamed",
      "opened",
      "trashed",
      "manual",
      undefined,
    ]) {
      expect(planExternalReload({ ...base, reason })).toEqual({
        kind: "ignore",
      });
    }
  });

  it("ignores changes when no note is open", () => {
    expect(planExternalReload({ ...base, activePath: "" })).toEqual({
      kind: "ignore",
    });
  });

  it("leaves a note whose directory is being renamed or trashed alone", () => {
    expect(
      planExternalReload({ ...base, isInDirectoryTransition: true }),
    ).toEqual({ kind: "ignore" });
  });

  it("reloads a note that has never been stamped", () => {
    expect(planExternalReload({ ...base, loaded: null })).toEqual({
      kind: "reload",
      path: "notes/today.md",
      modifiedAt: 2000,
    });
  });
});
