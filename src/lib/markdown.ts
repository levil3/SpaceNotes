const ASSET_URL_PREFIX = "notes-asset://vault/?";

const TABLE_DIVIDER =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function looksLikeTableRow(line: string) {
  return line.includes("|");
}

/**
 * Obsidian ends a table as soon as the next line is not a pipe row. GFM also
 * requires a block boundary, so add the missing blank line for existing notes
 * that put a paragraph or code fence immediately after a table.
 */
export function normalizeTableBoundaries(markdown: string) {
  const lineEnding = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let insideFence = false;
  let fenceMarker = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!insideFence) {
        insideFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        insideFence = false;
      }
      output.push(line);
      continue;
    }

    if (
      !insideFence &&
      looksLikeTableRow(line) &&
      TABLE_DIVIDER.test(lines[index + 1] || "")
    ) {
      output.push(line, lines[index + 1]);
      index += 2;

      while (
        index < lines.length &&
        lines[index].trim() &&
        looksLikeTableRow(lines[index])
      ) {
        output.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && lines[index].trim()) {
        output.push("");
      }
      index -= 1;
      continue;
    }

    output.push(line);
  }

  return output.join(lineEnding);
}

function isRelativeAsset(target: string) {
  const clean = target.trim();
  if (!clean) {
    return false;
  }

  const values = new Set([clean, decodeAssetPath(clean)]);
  for (const value of values) {
    if (
      value.startsWith("#") ||
      value.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(value) ||
      /^[a-z]:[\\/]/i.test(value)
    ) {
      return false;
    }
  }
  return true;
}

interface ParsedImage {
  alt: string;
  destination: string;
  destinationRaw: string;
  titleSuffix: string;
  end: number;
}

interface ParsedWikiImage {
  inner: string;
  target: string;
  end: number;
}

function decodeAssetPath(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function normalizeAssetPath(target: string) {
  return decodeAssetPath(target)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function parseAssetUrl(value: string) {
  // ProseMirror escapes the ampersands between URL query parameters when it
  // serializes a Markdown link, so parse the unescaped URL rather than leaving
  // a trailing backslash on the previous parameter value.
  return new URL(value.replace(/\\([\\()<>\[\]&])/g, "$1"));
}

function isEscaped(source: string, index: number) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function unescapeDestination(target: string) {
  return target.replace(/\\([\\()[\]<>])/g, "$1");
}

function parseImageAt(source: string, start: number): ParsedImage | null {
  if (!source.startsWith("![", start)) {
    return null;
  }

  let cursor = start + 2;
  let altEnd = -1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "]") {
      altEnd = cursor;
      break;
    }
    cursor += 1;
  }
  if (altEnd === -1) {
    return null;
  }

  cursor = altEnd + 1;
  if (source[cursor] !== "(") {
    return null;
  }
  cursor += 1;
  while (source[cursor] === " " || source[cursor] === "\t") {
    cursor += 1;
  }

  const destinationStart = cursor;
  let destination = "";
  let destinationRaw = "";
  let titleSuffix = "";
  if (source[cursor] === "<") {
    cursor += 1;
    let end = -1;
    while (cursor < source.length) {
      if (source[cursor] === "\\" && source[cursor + 1] === ">") {
        destination += ">";
        cursor += 2;
        continue;
      }
      if (source[cursor] === ">") {
        end = cursor;
        break;
      }
      destination += source[cursor];
      cursor += 1;
    }
    if (end === -1) {
      return null;
    }
    cursor = end + 1;
    destinationRaw = source.slice(destinationStart, cursor);

    let titleStart = cursor;
    while (source[cursor] === " " || source[cursor] === "\t") {
      cursor += 1;
    }
    if (
      cursor > titleStart &&
      (source[cursor] === '"' ||
        source[cursor] === "'" ||
        source[cursor] === "(")
    ) {
      const opening = source[cursor];
      const closing = opening === "(" ? ")" : opening;
      cursor += 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === closing) {
          cursor += 1;
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) {
        return null;
      }
      titleSuffix = source.slice(titleStart, cursor);
    } else {
      cursor = titleStart;
    }
  } else {
    let depth = 0;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "\\" && cursor + 1 < source.length) {
        cursor += 2;
        continue;
      }
      if (character === "(") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
        cursor += 1;
        continue;
      }
      cursor += 1;
    }
    if (source[cursor] !== ")") {
      return null;
    }
    const inner = source.slice(destinationStart, cursor);
    const titleMatch = inner.match(
      /\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))\s*$/,
    );
    if (titleMatch?.index !== undefined) {
      destinationRaw = inner.slice(0, titleMatch.index);
      titleSuffix = inner.slice(titleMatch.index);
    } else {
      destinationRaw = inner.trimEnd();
    }
    destination = unescapeDestination(destinationRaw.trim());
  }

  if (!destination) {
    return null;
  }
  while (source[cursor] === " " || source[cursor] === "\t") {
    cursor += 1;
  }
  if (source[cursor] !== ")") {
    return null;
  }

  return {
    alt: source.slice(start + 2, altEnd),
    destination: destination.trim(),
    destinationRaw,
    titleSuffix,
    end: cursor + 1,
  };
}

function parseWikiImageAt(
  source: string,
  start: number,
): ParsedWikiImage | null {
  if (!source.startsWith("![[", start)) {
    return null;
  }
  const end = source.indexOf("]]", start + 3);
  if (end === -1) {
    return null;
  }
  const inner = source.slice(start + 3, end);
  const target = inner.split("|", 1)[0].trim();
  if (
    !target ||
    !/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(target)
  ) {
    return null;
  }
  return { inner, target, end: end + 2 };
}

function assetUrl(
  notePath: string,
  target: string,
  source: string,
  embed?: "wiki",
) {
  const params = new URLSearchParams({
    note: notePath,
    target: normalizeAssetPath(target),
    source,
  });
  if (embed) {
    params.set("embed", embed);
  }
  return `${ASSET_URL_PREFIX}${params.toString()}`;
}

function escapeImageAlt(alt: string) {
  return alt.replace(/([\\\[\]])/g, "\\$1");
}

function transformImageLine(line: string, notePath: string) {
  let output = "";
  let cursor = 0;

  while (cursor < line.length) {
    if (line[cursor] === "`") {
      const tickCount = line.slice(cursor).match(/^`+/)?.[0].length || 1;
      let search = cursor + tickCount;
      let codeEnd = -1;
      while (search < line.length) {
        const next = line.indexOf("`", search);
        if (next === -1) {
          break;
        }
        const run = line.slice(next).match(/^`+/)?.[0].length || 1;
        if (run === tickCount) {
          codeEnd = next + run;
          break;
        }
        search = next + run;
      }
      if (codeEnd === -1) {
        output += line.slice(cursor);
        break;
      }
      output += line.slice(cursor, codeEnd);
      cursor = codeEnd;
      continue;
    }

    if (
      line[cursor] === "!" &&
      !isEscaped(line, cursor)
    ) {
      const wiki = parseWikiImageAt(line, cursor);
      if (wiki && isRelativeAsset(wiki.target)) {
        output +=
          `![${escapeImageAlt(wiki.target)}](` +
          `${assetUrl(notePath, wiki.target, wiki.inner, "wiki")})`;
        cursor = wiki.end;
        continue;
      }

      const image = parseImageAt(line, cursor);
      if (image && isRelativeAsset(image.destination)) {
        output +=
          `![${image.alt}](` +
          `${assetUrl(notePath, image.destination, image.destinationRaw)}` +
          `${image.titleSuffix})`;
        cursor = image.end;
        continue;
      }
    }

    output += line[cursor];
    cursor += 1;
  }

  return output;
}

/**
 * Milkdown expects browser-resolvable URLs. Relative note assets are routed
 * through the read-only notes-asset protocol. Both the note and original target
 * travel in the URL so the main process can resolve Obsidian's path variants
 * without changing the Markdown source.
 */
export function toEditorMarkdown(markdown: string, notePath: string) {
  const normalized = normalizeTableBoundaries(markdown);
  const lineEnding = normalized.includes("\r\n") ? "\r\n" : "\n";
  let insideFence = false;
  let fenceMarker = "";

  return normalized
    .split(/\r?\n/)
    .map((line) => {
      const fence = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        if (!insideFence) {
          insideFence = true;
          fenceMarker = fence[1][0];
        } else if (fence[1][0] === fenceMarker) {
          insideFence = false;
        }
        return line;
      }
      return insideFence ? line : transformImageLine(line, notePath);
    })
    .join(lineEnding);
}

export function toVaultMarkdown(markdown: string) {
  const restoredWikiEmbeds = markdown.replace(
    /!\[[^\]]*\]\((notes-asset:\/\/vault\/\?[^)\s]+)\)/g,
    (match: string, encodedUrl: string) => {
      try {
        const url = parseAssetUrl(encodedUrl);
        if (url.searchParams.get("embed") !== "wiki") {
          return match;
        }
        const source =
          url.searchParams.get("source") ||
          url.searchParams.get("target");
        return source ? `![[${source}]]` : match;
      } catch {
        return match;
      }
    },
  );

  const restored = restoredWikiEmbeds.replace(
    /notes-asset:\/\/vault\/\?([^)\s]+)/g,
    (_match: string, encodedPath: string) => {
      try {
        const url = parseAssetUrl(`${ASSET_URL_PREFIX}${encodedPath}`);
        return (
          url.searchParams.get("source") ||
          url.searchParams.get("target") ||
          encodedPath
        );
      } catch {
        return encodedPath;
      }
    },
  );

  // Keep compatibility with drafts and images created by the first prototype.
  const withLegacyAssets = restored.replace(
    /notes-asset:\/\/vault\/([^)\s?]+)/g,
    (_match: string, encodedPath: string) =>
      decodeURIComponent(encodedPath),
  );
  return unescapeObsidianBracketsOutsideFences(withLegacyAssets);
}

// A bracket that starts a line is escaped, because there it could become a
// link definition. Obsidian's own constructs must keep the bracket unescaped,
// otherwise they stop working once the note is saved: callouts "> [!note]",
// wikilinks "[[Note]]" and footnotes "[^1]". Fenced code is skipped so a
// sample that shows the escaped form is not rewritten on save.
const OBSIDIAN_BRACKET_PATTERN =
  /(?<!\\)\\\[(?:(?:\\)?\[[^\]\n]*\]\]|[!^][^\]\n]*\])/g;

function unescapeObsidianBracketsOutsideFences(markdown: string) {
  let insideFence = false;
  let fenceMarker = "";
  return markdown
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (!insideFence) {
          insideFence = true;
          fenceMarker = fence[1][0];
        } else if (fence[1][0] === fenceMarker) {
          insideFence = false;
        }
        return line;
      }
      if (insideFence) {
        return line;
      }
      return line.replace(OBSIDIAN_BRACKET_PATTERN, (match) =>
        match.replace(/\\/g, ""),
      );
    })
    .join("\n");
}
