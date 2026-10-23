import { describe, expect, it } from "vitest";
import { buildOutlineTree } from "./outline";

describe("buildOutlineTree", () => {
  it("nests headings beneath the closest lower-level heading", () => {
    const tree = buildOutlineTree([
      { level: 2, text: "关键原则", line: 1 },
      { level: 3, text: "配速自测", line: 3 },
      { level: 4, text: "循序渐进", line: 5 },
      { level: 2, text: "总结", line: 8 },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0].entry.text).toBe("关键原则");
    expect(tree[0].children[0].entry.text).toBe("配速自测");
    expect(tree[0].children[0].children[0].entry.text).toBe("循序渐进");
    expect(tree[1].entry.text).toBe("总结");
  });

  it("keeps skipped heading levels usable", () => {
    const tree = buildOutlineTree([
      { level: 2, text: "父级", line: 1 },
      { level: 4, text: "跳级子项", line: 3 },
    ]);

    expect(tree[0].children[0].entry.text).toBe("跳级子项");
  });
});
