export interface InsertTitleResult {
  markdown: string;
  inserted: boolean;
}

interface HeadingShortcutEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type EditorLinkTargetKind = "internal" | "external";

/**
 * Uses the physical digit key as the primary signal because keyboard layouts
 * can report shifted punctuation through event.key even for Ctrl+1.
 */
export function headingLevelFromShortcut(
  event: HeadingShortcutEvent,
): number | null {
  if (
    (!event.ctrlKey && !event.metaKey) ||
    event.altKey ||
    event.shiftKey
  ) {
    return null;
  }
  const physicalMatch = /^(?:Digit|Numpad)([0-6])$/.exec(event.code);
  const keyMatch = /^[0-6]$/.test(event.key) ? event.key : null;
  const value = physicalMatch?.[1] ?? keyMatch;
  return value === null ? null : Number(value);
}

function withoutFrontmatter(markdown: string) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

export function hasLeadingHeading(markdown: string) {
  return /^\s*#\s+\S/.test(withoutFrontmatter(markdown));
}

/**
 * Adds the note filename as an H1 without touching YAML frontmatter. Existing
 * H1 notes are left unchanged so Obsidian vaults do not gain duplicate titles
 * or accidental Git changes.
 */
export function insertTitleHeadingMarkdown(
  markdown: string,
  title: string,
): InsertTitleResult {
  const cleanTitle = title.replace(/\r?\n/g, " ").trim();
  if (!cleanTitle || hasLeadingHeading(markdown)) {
    return { markdown, inserted: false };
  }

  const lineEnding = markdown.includes("\r\n") ? "\r\n" : "\n";
  const frontmatter = markdown.match(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
  )?.[0];
  const body = frontmatter ? markdown.slice(frontmatter.length) : markdown;
  const heading = `# ${cleanTitle}${lineEnding}${lineEnding}`;

  return {
    markdown: `${frontmatter || ""}${heading}${body}`,
    inserted: true,
  };
}

/**
 * Converts the value entered in the editor link popover into a browser-safe
 * Markdown href. Internal note links receive the .md extension that SpaceNotes
 * uses for backlink discovery, while external links gain an explicit scheme so
 * Electron does not treat them as relative document paths.
 */
export function normalizeEditorLinkTarget(
  value: string,
  kind: EditorLinkTargetKind,
) {
  const target = value
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/\\/g, "/");
  if (!target) {
    return "";
  }

  if (kind === "external") {
    return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")
      ? target
      : `https://${target}`;
  }

  const [rawPath, ...hashParts] = target.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  if (!rawPath || /\.[a-z0-9]+$/i.test(rawPath)) {
    return `${rawPath}${hash}`;
  }
  return `${rawPath}.md${hash}`;
}
