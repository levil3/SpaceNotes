import { describe, expect, it } from "vitest";
import {
  normalizeTableBoundaries,
  toEditorMarkdown,
  toVaultMarkdown,
} from "./markdown";

describe("Markdown asset URLs", () => {
  it("round-trips vault-relative image paths without changing the source", () => {
    const source = "![diagram](images/example.png)";
    const editor = toEditorMarkdown(source, "notes/Java Base/example.md");

    expect(editor).toContain("notes-asset://vault/?");
    expect(editor).toContain("note=notes%2FJava+Base%2Fexample.md");
    expect(toVaultMarkdown(editor)).toBe(source);
  });

  it("round-trips legacy Windows separators used by older notes", () => {
    const source = "![diagram](..\\..\\images\\example.png)";
    const editor = toEditorMarkdown(source, "notes/Architect/CaseAnalysis/example.md");

    expect(toVaultMarkdown(editor)).toBe(source);
  });

  it("round-trips encoded, spaced, titled, and parenthesized paths", () => {
    const source = [
      "![encoded](images/my%20image.png)",
      '![title](images/my image.png "图片标题")',
      "![angle](<images/my image.png> '说明')",
      "![paren](images/paren(1).png)",
      "![escaped](images/paren\\(2\\).png)",
    ].join("\n");
    const editor = toEditorMarkdown(source, "notes/example.md");

    expect(editor.match(/notes-asset:\/\/vault\/\?/g)).toHaveLength(5);
    expect(editor).toContain("target=images%2Fmy+image.png");
    expect(editor).not.toContain("target=images%2Fmy%2520image.png");
    expect(toVaultMarkdown(editor)).toBe(source);
  });

  it("renders and restores Obsidian image embeds", () => {
    const source = [
      "![[图片.png]]",
      "![[images/photo one.png|320]]",
    ].join("\n");
    const editor = toEditorMarkdown(source, "notes/example.md");

    expect(editor).not.toContain("![[");
    expect(editor.match(/embed=wiki/g)).toHaveLength(2);
    expect(toVaultMarkdown(editor)).toBe(source);
  });

  it("restores URLs escaped by the Markdown serializer", () => {
    const source = [
      "![encoded](images/my%20image.png)",
      "![[图片.png]]",
      "![[images/photo one.png|320]]",
    ].join("\n");
    const editor = toEditorMarkdown(source, "notes/example.md");
    const serialized = editor.replace(/&/g, "\\&");

    expect(toVaultMarkdown(serialized)).toBe(source);
  });

  it("does not rewrite image syntax inside inline or fenced code", () => {
    const source = [
      "`![inline](images/inline.png)`",
      "```md",
      "![fenced](images/fenced.png)",
      "```",
    ].join("\n");

    expect(toEditorMarkdown(source, "notes/example.md")).toBe(source);
  });

  it("keeps absolute and web image URLs untouched", () => {
    const source = [
      "![local](C:/images/example.png)",
      "![web](https://example.com/example.png)",
    ].join("\n");

    expect(toEditorMarkdown(source, "notes/example.md")).toBe(source);
  });

  it("ends a table before the next paragraph when the source has no blank line", () => {
    const source = [
      "| 变量 | 描述 |",
      "| --- | --- |",
      "| deltaMap | 增量分区表 |",
      "deltaMap结构：",
      "```java",
      "class DeltaMap {}",
      "```",
    ].join("\n");

    expect(normalizeTableBoundaries(source)).toBe(
      [
        "| 变量 | 描述 |",
        "| --- | --- |",
        "| deltaMap | 增量分区表 |",
        "",
        "deltaMap结构：",
        "```java",
        "class DeltaMap {}",
        "```",
      ].join("\n"),
    );
  });

  it("does not rewrite pipe-like content inside fenced code", () => {
    const source = ["```text", "a | b", "--- | ---", "```"].join("\n");
    expect(normalizeTableBoundaries(source)).toBe(source);
  });

  it("restores Obsidian callout markers escaped by Milkdown", () => {
    const source = ["> \\[!note]", ">", "> 正文"].join("\n");
    expect(toVaultMarkdown(source)).toBe(
      ["> [!note]", ">", "> 正文"].join("\n"),
    );
  });
});
