import type { FileNode } from "./paths";

export interface FileTreeSelectionItem {
  path: string;
  kind: "file" | "folder";
}

/**
 * Flattens the currently visible tree in display order. Collapsed folders
 * contribute only their own row, matching the range users can see and click.
 */
export function listVisibleTreeItems(
  nodes: FileNode[],
  expanded: ReadonlySet<string>,
): FileTreeSelectionItem[] {
  const items: FileTreeSelectionItem[] = [];

  const visit = (children: FileNode[]) => {
    for (const node of children) {
      items.push({ path: node.path, kind: node.type });
      if (node.type === "folder" && expanded.has(node.path)) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return items;
}

export function listAllTreeItems(nodes: FileNode[]) {
  const items: FileTreeSelectionItem[] = [];

  const visit = (children: FileNode[]) => {
    for (const node of children) {
      items.push({ path: node.path, kind: node.type });
      if (node.type === "folder") {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return items;
}

/**
 * Returns every row between the anchor and target, including both endpoints.
 * If the anchor is no longer visible, selection falls back to the target row.
 */
export function selectVisibleTreeRange(
  items: FileTreeSelectionItem[],
  anchorPath: string,
  targetPath: string,
) {
  const targetIndex = items.findIndex((item) => item.path === targetPath);
  if (targetIndex < 0) {
    return [];
  }

  const anchorIndex = items.findIndex((item) => item.path === anchorPath);
  if (anchorIndex < 0) {
    return [items[targetIndex].path];
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return items.slice(start, end + 1).map((item) => item.path);
}

export function collectTreePaths(nodes: FileNode[]) {
  const paths = new Set<string>();

  const visit = (children: FileNode[]) => {
    for (const node of children) {
      paths.add(node.path);
      if (node.type === "folder") {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return paths;
}
