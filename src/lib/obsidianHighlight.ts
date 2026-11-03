import { visit } from "unist-util-visit";
import type { Root } from "@milkdown/kit/transformer";

/**
 * Obsidian 的高亮语法是 `==文字==`。本仓库的部分笔记沿用 `++文字++`，
 * 两者都按高亮处理，并且保留原有标记，写回时不会擅自改写用户的文件。
 */
export type HighlightMarker = "==" | "++";

export const HIGHLIGHT_MARKERS: HighlightMarker[] = ["==", "++"];

export interface HighlightTextNode {
  type: "text";
  value: string;
}

export interface HighlightNode {
  type: "highlight";
  marker: HighlightMarker;
  children: HighlightTextNode[];
}

export type HighlightChild = HighlightTextNode | HighlightNode;

/**
 * 标记后必须紧跟非空白字符，闭合标记前也必须是非空白字符，
 * 避免把普通句子里的 `==` 误判成高亮。
 */
const HIGHLIGHT_PATTERN = /(==|\+\+)(?=\S)([\s\S]*?\S)\1/g;

export function splitHighlightText(value: string): HighlightChild[] | null {
  const pattern = new RegExp(HIGHLIGHT_PATTERN.source, "g");
  const children: HighlightChild[] = [];
  let lastIndex = 0;
  let match = pattern.exec(value);

  while (match) {
    const [full, marker, content] = match;
    const start = match.index;
    if (start > lastIndex) {
      children.push({ type: "text", value: value.slice(lastIndex, start) });
    }
    children.push({
      type: "highlight",
      marker: marker as HighlightMarker,
      children: [{ type: "text", value: content }],
    });
    lastIndex = start + full.length;
    match = pattern.exec(value);
  }

  if (children.length === 0) {
    return null;
  }
  if (lastIndex < value.length) {
    children.push({ type: "text", value: value.slice(lastIndex) });
  }
  return children;
}

/**
 * remark 插件：把文本节点里的 `==文字==` 与 `++文字++` 变成 highlight 节点，
 * 交给 Milkdown 的 mark schema 解析成编辑器里的高亮标记。
 *
 * 代码块、行内代码与链接地址不在 text 节点里，因此不会被误高亮。
 */
export function remarkHighlight() {
  // unified 的插件工厂：先接收设置，再返回真正处理树的转换函数。
  return () => (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || typeof index !== "number") {
        return;
      }
      const children = splitHighlightText(node.value);
      if (!children) {
        return;
      }
      parent.children.splice(index, 1, ...(children as never[]));
      // 跳过刚插入的节点，避免重复处理。
      return index + children.length;
    });
  };
}
