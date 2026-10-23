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
});
