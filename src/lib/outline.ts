import type { OutlineEntry } from "../types";

export interface OutlineNode {
  id: string;
  entry: OutlineEntry;
  children: OutlineNode[];
}

/**
 * Turns the flat Markdown heading list into a hierarchy using a stack. Headings
 * may skip levels, so each item attaches to the closest preceding lower level.
 */
export function buildOutlineTree(entries: OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  entries.forEach((entry, index) => {
    const node: OutlineNode = {
      id: `${entry.line}:${entry.level}:${entry.text}:${index}`,
      entry,
      children: [],
    };

    while (
      stack.length &&
      stack[stack.length - 1].entry.level >= entry.level
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });

  return roots;
}
