import { remarkPluginsCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { markRule } from "@milkdown/kit/prose";
import { $inputRule, $markSchema } from "@milkdown/kit/utils";
import { remarkHighlight } from "./obsidianHighlight";

/**
 * Obsidian 高亮在编辑器里的表示。`==文字==` 是 Obsidian 标准写法，
 * `++文字++` 是本仓库部分笔记沿用的别名，两者写回时都保留原标记。
 */
export const highlightSchema = $markSchema("highlight", () => ({
  attrs: {
    marker: {
      default: "==",
      validate: "string",
    },
  },
  parseDOM: [{ tag: "mark" }],
  toDOM: (mark) => ["mark", { "data-marker": mark.attrs.marker }, 0],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType, { marker: node.marker ?? "==" });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      state.withMark(mark, "highlight", undefined, {
        marker: mark.attrs.marker,
      });
    },
  },
}));

/**
 * 打字时自动成标记，与 Obsidian 的输入体验一致。
 *
 * `==` 允许紧跟单词字符，Obsidian 就是这样处理的；`++` 不是 Obsidian 语法，
 * 而且常见于 `C++`、`i++` 这类文本，因此要求前面是非单词字符。
 */
export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(==)(?=\S)([^\s]*?\S)\1(?![\w/])$/, highlightSchema.type(ctx), {
    getAttr: () => ({ marker: "==" }),
  }),
);

export const highlightAliasInputRule = $inputRule((ctx) =>
  markRule(
    /(?<![\w:/])(\+\+)(?=\S)([^\s]*?\S)\1(?![\w/])$/,
    highlightSchema.type(ctx),
    {
      getAttr: () => ({ marker: "++" }),
    },
  ),
);

interface StringifyState {
  enter: (type: string) => () => void;
  containerPhrasing: (
    node: { type: "root"; children: unknown[] },
    info: unknown,
  ) => string;
}

interface HighlightMdastNode {
  marker?: string;
  children?: unknown[];
}

/**
 * remark-stringify 不认识 highlight 这种自定义节点，必须补一个 handler，
 * 否则序列化时会抛「Cannot handle unknown node」。
 *
 * 这段必须在 Config 阶段写入，早于 remark 实例的创建，
 * 否则 remark-stringify 会用旧的 options 先把实例建好。
 */
export const highlightStringifyHandler = (
  node: HighlightMdastNode,
  _parent: unknown,
  state: StringifyState,
  info: unknown,
) => {
  const marker = node.marker === "++" ? "++" : "==";
  const exit = state.enter("phrasing");
  // 只把子节点交给 containerPhrasing，避免再次进入本 handler 造成递归。
  const value = state.containerPhrasing(
    { type: "root", children: node.children ?? [] },
    info,
  );
  exit();
  return `${marker}${value}${marker}`;
};

/**
 * 注册到 Crepe 编辑器。必须在 create() 之前 addFeature。
 */
export const obsidianHighlightFeature = (editor: Editor) => {
  editor
    // highlightSchema 是 [ctx 插件, mark 插件] 的元组，两个都必须注册：
    // 少了 ctx 插件，mark 的 schema 就拿不到，编辑器会报
    // Context "highlight" not found。
    .use(highlightSchema)
    .use(highlightInputRule)
    .use(highlightAliasInputRule)
    .config((ctx) => {
      // remark 插件必须在 Config 阶段写入。schema 插件在 InitReady 之后才读取
      // remarkPluginsCtx，而 $remark 的写法要等 InitReady 才写入，会慢一步，
      // 导致自定义语法在编辑器里不生效。
      ctx.update(remarkPluginsCtx, (prev) => [
        ...prev,
        { plugin: remarkHighlight(), options: {} },
      ]);
      ctx.update(remarkStringifyOptionsCtx, (prev) => {
        const handlers = (prev.handlers ?? {}) as Record<string, unknown>;
        return {
          ...prev,
          handlers: {
            ...handlers,
            highlight: highlightStringifyHandler,
          } as typeof prev.handlers,
        };
      });
    });
};
