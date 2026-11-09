import { describe, expect, it } from "vitest";
import { toVaultMarkdown } from "./markdown";
import { narrowBracketRule } from "./markdownFidelity";

describe("toVaultMarkdown Obsidian bracket fidelity", () => {
  it("keeps a callout marker unescaped", () => {
    expect(toVaultMarkdown("> \\[!note] 提示")).toBe("> [!note] 提示");
  });

  it("keeps a wikilink unescaped", () => {
    expect(toVaultMarkdown("\\[\\[某篇笔记]]")).toBe("[[某篇笔记]]");
    expect(toVaultMarkdown("\\[\\[某篇笔记|别名]]")).toBe("[[某篇笔记|别名]]");
    // A wikilink at the start of a line only has its first bracket escaped.
    expect(toVaultMarkdown("\\[[某篇笔记]]")).toBe("[[某篇笔记]]");
  });

  it("keeps a footnote unescaped", () => {
    expect(toVaultMarkdown("脚注\\[^1]")).toBe("脚注[^1]");
    expect(toVaultMarkdown("\\[^1] 脚注引用")).toBe("[^1] 脚注引用");
  });

  it("leaves a deliberately escaped bracket alone", () => {
    expect(toVaultMarkdown("反斜杠\\\\\\[方括号]")).toBe("反斜杠\\\\\\[方括号]");
  });

  it("does not touch brackets that were never escaped", () => {
    expect(toVaultMarkdown("普通 [文字] 保持")).toBe("普通 [文字] 保持");
  });

  it("also protects tilde fences and unclosed trailing fences", () => {
    const source = [
      "~~~md",
      "\\[\\[示例笔记]]",
      "~~~",
      "正文 \\[\\[真实链接]]",
      "```",
      "\\[\\[仍未闭合]]",
    ].join("\n");
    expect(toVaultMarkdown(source)).toBe(
      [
        "~~~md",
        "\\[\\[示例笔记]]",
        "~~~",
        "正文 [[真实链接]]",
        "```",
        "\\[\\[仍未闭合]]",
      ].join("\n"),
    );
  });

  it("leaves escaped brackets inside a fenced code block alone", () => {
    const source = [
      "```md",
      "\\[\\[示例笔记]]",
      "> \\[!note] 示例",
      "```",
      "",
      "正文 \\[\\[真实链接]]",
    ].join("\n");
    expect(toVaultMarkdown(source)).toBe(
      ["```md", "\\[\\[示例笔记]]", "> \\[!note] 示例", "```", "", "正文 [[真实链接]]"].join(
        "\n",
      ),
    );
  });
});

describe("narrowBracketRule", () => {
  it("drops the rule that escapes every bracket in phrasing text", () => {
    expect(
      narrowBracketRule({ character: "[", inConstruct: "phrasing" }),
    ).toBeNull();
  });

  it("takes phrasing out of a rule that also covers labels and references", () => {
    expect(
      narrowBracketRule({
        character: "[",
        inConstruct: ["label", "phrasing", "reference"],
      }),
    ).toEqual({
      character: "[",
      inConstruct: ["label", "reference"],
    });
  });

  it("keeps the rule that protects a line starting with a bracket", () => {
    expect(
      narrowBracketRule({ character: "[", atBreak: true } as never),
    ).toEqual({ character: "[", atBreak: true });
    expect(
      narrowBracketRule({
        character: "[",
        inConstruct: ["label", "reference"],
      }),
    ).toEqual({ character: "[", inConstruct: ["label", "reference"] });
  });

  it("ignores other characters", () => {
    expect(
      narrowBracketRule({ character: "*", inConstruct: "phrasing" }),
    ).toEqual({ character: "*", inConstruct: "phrasing" });
  });
});
