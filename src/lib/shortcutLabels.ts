/**
 * Keyboard-shortcut labels differ between the Windows and macOS shells. The
 * app accepts both Ctrl and Command, so the only real difference is how the
 * combination should be spelled in menus and tooltips.
 */
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];

export function isMacPlatform(): boolean {
  const hostPlatform =
    typeof document === "undefined"
      ? undefined
      : document.documentElement?.dataset?.hostPlatform;
  if (hostPlatform) {
    return hostPlatform === "macos";
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

function macSymbol(part: string): string {
  const symbols: Record<string, string> = {
    Ctrl: "⌘",
    Cmd: "⌘",
    Command: "⌘",
    Alt: "⌥",
    Option: "⌥",
    Shift: "⇧",
  };
  return symbols[part] ?? part;
}

/** Rewrites "Ctrl+Shift+F" into "⇧⌘F" on macOS; other platforms keep it. */
export function formatShortcutForPlatform(
  label: string,
  mac: boolean,
): string {
  if (!mac) {
    return label;
  }
  const parts = label.split(/[+\s]+/).filter(Boolean);
  if (parts.length === 0) {
    return label;
  }
  const symbols = parts.map(macSymbol);
  const modifiers = symbols
    .slice(0, -1)
    .sort(
      (left, right) =>
        MAC_MODIFIER_ORDER.indexOf(left) - MAC_MODIFIER_ORDER.indexOf(right),
    );
  return [...modifiers, symbols[symbols.length - 1]].join("");
}

export function formatShortcut(label: string): string {
  return formatShortcutForPlatform(label, isMacPlatform());
}
