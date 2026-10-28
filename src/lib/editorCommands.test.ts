import { describe, expect, it } from "vitest";
import {
  hasLeadingHeading,
  headingLevelFromShortcut,
  insertTitleHeadingMarkdown,
} from "./editorCommands";

describe("editor title commands", () => {
  it("adds the note title before existing content", () => {
    expect(insertTitleHeadingMarkdown("正文", "项目记录")).toEqual({
      markdown: "# 项目记录\n\n正文",
      inserted: true,
    });
  });

  it("keeps YAML frontmatter at the top", () => {
    expect(
      insertTitleHeadingMarkdown(
        "---\ntags:\n  - notes\n---\n正文",
        "项目记录",
      ),
    ).toEqual({
      markdown: "---\ntags:\n  - notes\n---\n# 项目记录\n\n正文",
      inserted: true,
    });
  });

  it("preserves CRLF files", () => {
    expect(insertTitleHeadingMarkdown("正文", "项目记录").markdown).toContain(
      "\n",
    );
    expect(
      insertTitleHeadingMarkdown("第一行\r\n第二行", "项目记录").markdown,
    ).toBe("# 项目记录\r\n\r\n第一行\r\n第二行");
  });

  it("does not duplicate an existing H1", () => {
    const markdown = "---\ntags: notes\n---\n\n# 已有标题\n正文";
    expect(hasLeadingHeading(markdown)).toBe(true);
    expect(insertTitleHeadingMarkdown(markdown, "项目记录")).toEqual({
      markdown,
      inserted: false,
    });
  });

  it("recognizes heading shortcuts by physical digit keys", () => {
    const base = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };

    expect(
      headingLevelFromShortcut({
        ...base,
        key: "!",
        code: "Digit1",
      }),
    ).toBe(1);
    expect(
      headingLevelFromShortcut({
        ...base,
        key: "0",
        code: "Numpad0",
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(0);
    expect(
      headingLevelFromShortcut({
        ...base,
        key: "1",
        code: "",
      }),
    ).toBe(1);
    expect(
      headingLevelFromShortcut({
        ...base,
        key: "1",
        code: "Digit1",
        altKey: true,
      }),
    ).toBeNull();
    expect(
      headingLevelFromShortcut({
        ...base,
        key: "1",
        code: "Digit1",
        ctrlKey: false,
      }),
    ).toBeNull();
  });
});
