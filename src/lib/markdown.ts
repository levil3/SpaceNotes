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
  return (
    clean &&
    !clean.startsWith("#") &&
    !clean.startsWith("/") &&
    !clean.startsWith("data:") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(clean)
  );
}

/**
 * Milkdown expects browser-resolvable URLs. Relative note assets are routed
 * through the read-only notes-asset protocol. Both the note and original target
 * travel in the URL so the main process can resolve Obsidian's path variants
 * without changing the Markdown source.
 */
export function toEditorMarkdown(markdown: string, notePath: string) {
  return normalizeTableBoundaries(markdown).replace(
    /(!\[[^\]]*]\()([^)]+)(\))/g,
    (_match: string, prefix: string, target: string, suffix: string) => {
      if (!isRelativeAsset(target)) {
        return `${prefix}${target}${suffix}`;
      }
      const params = new URLSearchParams({
        note: notePath,
        target,
      });
      return `${prefix}${ASSET_URL_PREFIX}${params.toString()}${suffix}`;
    },
  );
}

export function toVaultMarkdown(markdown: string) {
  const restored = markdown.replace(
    /notes-asset:\/\/vault\/\?([^)\s]+)/g,
    (_match: string, encodedPath: string) => {
      try {
        const url = new URL(`${ASSET_URL_PREFIX}${encodedPath}`);
        return url.searchParams.get("target") || encodedPath;
      } catch {
        return encodedPath;
      }
    },
  );

  // Keep compatibility with drafts and images created by the first prototype.
  return restored.replace(
    /notes-asset:\/\/vault\/([^)\s?]+)/g,
    (_match: string, encodedPath: string) => decodeURIComponent(encodedPath),
  );
}
