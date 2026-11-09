import { describe, expect, it } from "vitest";
import { formatShortcutForPlatform } from "./shortcutLabels";

describe("formatShortcutForPlatform", () => {
  it("keeps Windows/Linux labels untouched", () => {
    expect(formatShortcutForPlatform("Ctrl+Shift+F", false)).toBe(
      "Ctrl+Shift+F",
    );
    expect(formatShortcutForPlatform("Alt+1", false)).toBe("Alt+1");
  });

  it("rewrites combinations with macOS modifier symbols", () => {
    expect(formatShortcutForPlatform("Ctrl+Shift+F", true)).toBe("⇧⌘F");
    expect(formatShortcutForPlatform("Alt+1", true)).toBe("⌥1");
    expect(formatShortcutForPlatform("Ctrl+B", true)).toBe("⌘B");
    expect(formatShortcutForPlatform("Ctrl P", true)).toBe("⌘P");
  });

  it("orders macOS modifiers the way system menus do", () => {
    expect(formatShortcutForPlatform("Ctrl+Alt+Shift+X", true)).toBe(
      "⌥⇧⌘X",
    );
  });

  it("leaves plain labels alone", () => {
    expect(formatShortcutForPlatform("F3", true)).toBe("F3");
    expect(formatShortcutForPlatform("", true)).toBe("");
  });
});
