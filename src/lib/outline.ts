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

/**
 * Collects only nodes that actually have children. The outline "collapse all"
 * action uses this set so top-level headings remain visible as entry points.
 */
export function collectCollapsibleOutlineIds(
  nodes: OutlineNode[],
): Set<string> {
  const ids = new Set<string>();

  const visit = (children: OutlineNode[]) => {
    for (const node of children) {
      if (node.children.length) {
        ids.add(node.id);
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return ids;
}
