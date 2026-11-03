import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";

interface UnsafePattern {
  character?: string;
  inConstruct?: unknown;
  _compiled?: unknown;
}

/**
 * mdast-util-to-markdown 会把正文里的每一个 "[" 转义，免得它被当成链接开头。
 * 结果渲染出来一样，文件却被改写了：Obsidian 的 [[wikilink]] 与 [^footnote]
 * 不再是 wikilink 和脚注，`a[0]` 这类普通文本也会多出一个转义符。
 *
 * 这里把"作用于正文"的那条规则收窄掉，让方括号保持用户写的样子。
 * 行首的 "[" 仍然要转义——在那里它真的会变成链接定义。
 */
export function narrowBracketRule(
  pattern: UnsafePattern,
): UnsafePattern | null {
  if (pattern.character !== "[") {
    return pattern;
  }
  const scope = pattern.inConstruct;
  if (scope === "phrasing") {
    return null;
  }
  if (Array.isArray(scope) && scope.includes("phrasing")) {
    // 保留 label 与 reference 的作用域，只把正文从作用域里去掉。
    const { _compiled: _ignored, ...rest } = pattern;
    return {
      ...rest,
      inConstruct: scope.filter((entry) => entry !== "phrasing"),
    };
  }
  return pattern;
}

interface StringifyState {
  unsafe: UnsafePattern[];
  safe: (value: string, info: unknown) => string;
}

interface TextNode {
  value?: string;
}

interface TextParent {
  children?: unknown[];
}

/**
 * 与 mdast-util-to-markdown 默认的 text handler 相同，只是不再把正文里的
 * "[" 转义。afterNode 与 beforeNode 必须照传，否则相邻文本的转义判断会失准。
 */
export const markdownFidelityTextHandler = (
  node: TextNode,
  parent: TextParent | undefined,
  state: StringifyState,
  info: unknown,
): string => {
  const siblings: unknown[] = parent?.children ?? [];
  const index = siblings.indexOf(node);
  const original = state.unsafe;
  state.unsafe = original
    .map(narrowBracketRule)
    .filter((pattern): pattern is UnsafePattern => pattern !== null);
  try {
    return state.safe(node.value ?? "", {
      ...(info as Record<string, unknown>),
      afterNode: siblings[index + 1],
      beforeNode: siblings[index - 1],
    });
  } finally {
    state.unsafe = original;
  }
};

/**
 * 注册到 Crepe 编辑器。必须在 create() 之前 addFeature。
 */
export const markdownFidelityFeature = (editor: Editor) => {
  editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => {
      const handlers = (prev.handlers ?? {}) as Record<string, unknown>;
      return {
        ...prev,
        handlers: {
          ...handlers,
          text: markdownFidelityTextHandler,
        } as typeof prev.handlers,
      };
    });
  });
};
