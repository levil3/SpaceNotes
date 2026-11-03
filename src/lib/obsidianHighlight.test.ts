import { describe, expect, it } from "vitest";
import { splitHighlightText, remarkHighlight } from "./obsidianHighlight";

describe("splitHighlightText", () => {
  it("recognises Obsidian's ==highlight== syntax", () => {
    expect(splitHighlightText("生成偏好序列")).toBeNull();
    expect(splitHighlightText("==生成偏好序列==")).toEqual([
      {
        type: "highlight",
        marker: "==",
        children: [{ type: "text", value: "生成偏好序列" }],
      },
    ]);
  });

  it("keeps the surrounding text as plain nodes", () => {
    expect(splitHighlightText("前缀 ==重点== 后缀")).toEqual([
      { type: "text", value: "前缀 " },
      {
        type: "highlight",
        marker: "==",
        children: [{ type: "text", value: "重点" }],
      },
      { type: "text", value: " 后缀" },
    ]);
  });

  it("accepts the ++highlight++ alias used by older notes", () => {
    expect(splitHighlightText("++重点++")).toEqual([
      {
        type: "highlight",
        marker: "++",
        children: [{ type: "text", value: "重点" }],
      },
    ]);
  });

  it("ignores markers that are not followed by content", () => {
    expect(splitHighlightText("== 未闭合")).toBeNull();
    expect(splitHighlightText("== 两侧有空格 ==")).toBeNull();
    expect(splitHighlightText("a == b")).toBeNull();
  });

  it("leaves ordinary prose alone", () => {
    expect(splitHighlightText("C++ 与 a == b 的比较")).toBeNull();
  });

  it("handles several highlights in one line", () => {
    expect(splitHighlightText("==甲== 与 ==乙==")).toEqual([
      {
        type: "highlight",
        marker: "==",
        children: [{ type: "text", value: "甲" }],
      },
      { type: "text", value: " 与 " },
      {
        type: "highlight",
        marker: "==",
        children: [{ type: "text", value: "乙" }],
      },
    ]);
  });
});

describe("remarkHighlight", () => {
  it("replaces highlighted text nodes with highlight nodes", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "==重点==" }],
        },
      ],
    };
    remarkHighlight()()(tree as never);
    expect(tree.children[0].children).toEqual([
      {
        type: "highlight",
        marker: "==",
        children: [{ type: "text", value: "重点" }],
      },
    ]);
  });

  it("leaves code spans untouched", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "inlineCode", value: "==不是高亮==" }],
        },
      ],
    };
    remarkHighlight()()(tree as never);
    expect(tree.children[0].children).toEqual([
      { type: "inlineCode", value: "==不是高亮==" },
    ]);
  });
});
