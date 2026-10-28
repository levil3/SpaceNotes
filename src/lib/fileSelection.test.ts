import { describe, expect, it } from "vitest";
import {
  collectTreePaths,
  listVisibleTreeItems,
  selectVisibleTreeRange,
} from "./fileSelection";
import type { FileNode } from "./paths";

const note = (path: string) => ({
  path,
  title: path,
  modifiedAt: 0,
  size: 0,
  tags: [],
});

const tree: FileNode[] = [
  {
    type: "folder",
    name: "Projects",
    path: "Projects",
    children: [
      {
        type: "folder",
        name: "Nested",
        path: "Projects/Nested",
        children: [
          {
            type: "file",
            name: "Deep",
            path: "Projects/Nested/Deep.md",
            note: note("Projects/Nested/Deep.md"),
          },
        ],
      },
      {
        type: "file",
        name: "Plan",
        path: "Projects/Plan.md",
        note: note("Projects/Plan.md"),
      },
    ],
  },
  {
    type: "file",
    name: "Home",
    path: "Home.md",
    note: note("Home.md"),
  },
];

describe("file tree selection", () => {
  it("only includes rows visible under expanded folders", () => {
    expect(
      listVisibleTreeItems(tree, new Set(["Projects"])).map(
        (item) => item.path,
      ),
    ).toEqual(["Projects", "Projects/Nested", "Projects/Plan.md", "Home.md"]);
  });

  it("selects a continuous range in either direction", () => {
    const items = listVisibleTreeItems(
      tree,
      new Set(["Projects", "Projects/Nested"]),
    );

    expect(
      selectVisibleTreeRange(items, "Projects/Nested/Deep.md", "Home.md"),
    ).toEqual([
      "Projects/Nested/Deep.md",
      "Projects/Plan.md",
      "Home.md",
    ]);
    expect(
      selectVisibleTreeRange(items, "Home.md", "Projects/Nested"),
    ).toEqual([
      "Projects/Nested",
      "Projects/Nested/Deep.md",
      "Projects/Plan.md",
      "Home.md",
    ]);
  });

  it("collects paths from collapsed folders for selection cleanup", () => {
    expect([...collectTreePaths(tree)]).toContain(
      "Projects/Nested/Deep.md",
    );
  });
});
