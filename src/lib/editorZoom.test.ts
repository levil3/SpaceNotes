import { describe, expect, it } from "vitest";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  adjustEditorFontSize,
} from "./editorZoom";

describe("editor zoom", () => {
  it("changes the font size by one pixel", () => {
    expect(adjustEditorFontSize(15, 1)).toBe(16);
    expect(adjustEditorFontSize(15, -1)).toBe(14);
  });

  it("keeps the font size within the supported range", () => {
    expect(adjustEditorFontSize(EDITOR_FONT_SIZE_MIN, -1)).toBe(
      EDITOR_FONT_SIZE_MIN,
    );
    expect(adjustEditorFontSize(EDITOR_FONT_SIZE_MAX, 1)).toBe(
      EDITOR_FONT_SIZE_MAX,
    );
  });
});
