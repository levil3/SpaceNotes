import { describe, expect, it } from "vitest";
import type { NoteFile } from "../types";
import {
  buildFileTree,
  isHiddenPath,
  remapPathAfterDirectoryRename,
} from "./paths";

const note: NoteFile = {
  path: ".drafts/secret.md",
  title: "Secret",
  modifiedAt: 1,
  size: 10,
  tags: [],
};

describe("file tree paths", () => {
  it("detects hidden directories and files at any depth", () => {
    expect(isHiddenPath(".drafts/secret.md")).toBe(true);
    expect(isHiddenPath("notes/.private.md")).toBe(true);
    expect(isHiddenPath("notes/public.md")).toBe(false);
  });

  it("keeps empty and hidden directories in the tree", () => {
    const tree = buildFileTree(
      [note],
      [".drafts", ".drafts/archive", "empty"],
    );
    const drafts = tree.find((node) => node.path === ".drafts");
    const empty = tree.find((node) => node.path === "empty");

    expect(drafts?.type).toBe("folder");
    expect(
      drafts?.type === "folder"
        ? drafts.children.find((child) => child.path === ".drafts/archive")
        : null,
    ).toMatchObject({ type: "folder" });
    expect(empty).toMatchObject({ type: "folder", name: "empty" });
  });

  it("remaps only paths inside a renamed directory", () => {
    const rename = (path: string) =>
      remapPathAfterDirectoryRename(
        path,
        "notes/archive",
        "notes/history",
      );

    expect(rename("notes/archive/2026/today.md")).toBe(
      "notes/history/2026/today.md",
    );
    expect(rename("notes/archive-old/today.md")).toBe(
      "notes/archive-old/today.md",
    );
    expect(rename("other/today.md")).toBe("other/today.md");
  });
});
