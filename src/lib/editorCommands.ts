export interface InsertTitleResult {
  markdown: string;
  inserted: boolean;
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
