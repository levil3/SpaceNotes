export const EDITOR_FONT_SIZE_MIN = 13;
export const EDITOR_FONT_SIZE_MAX = 21;

/**
 * Keeps Ctrl+wheel zoom inside the same bounds used by the appearance panel.
 * The returned value can be compared with the current size to skip writes at
 * either limit.
 */
export function adjustEditorFontSize(
  currentSize: number,
  step: -1 | 1,
) {
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, currentSize + step),
  );
}
