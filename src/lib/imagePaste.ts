import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  clipboardLooksEmpty,
  collectClipboardImages,
  toAttachmentPayload,
  type AttachmentPayload,
} from "./attachment";
import { imageEditorUrl } from "./markdown";

export interface ImagePasteOptions {
  /** 当前笔记路径，用来决定附件目录与相对引用写法。 */
  notePath: string;
  /** 落盘并返回可以直接写进 Markdown 的相对路径。 */
  saveAttachment(payload: {
    name: string;
    data: string;
  }): Promise<{ path: string; target: string }>;
  /** 失败时给用户一个可见的提示，而不是静默吞掉。 */
  onError(message: string): void;
  /**
   * 从系统剪贴板读出 PNG base64。WKWebView 对截图粘贴常常既不提供
   * text/plain 也不提供文件，只能由宿主补上。
   */
  readClipboardImage?(): Promise<string>;
}

const HOST_IMAGE_NAME = "pasted.png";

/**
 * 代码块（含 Mermaid/LaTeX 的 CodeMirror 视图）只接受文本，图片插进去会让
 * ProseMirror 抛错，所以这些位置交回默认处理。
 */
function selectionIsCode(view: EditorView) {
  return Boolean(view.state.selection.$from.parent.type.spec.code);
}

/**
 * 把已读出的图片字节落盘并插入编辑器。插入点会在异步落盘结束后重新取，
 * 因为这段时间里文档可能已经被继续编辑。
 */
async function insertPayloads(
  view: EditorView,
  options: ImagePasteOptions,
  payloads: AttachmentPayload[],
  position: number,
) {
  let nodes;
  try {
    const imageType = view.state.schema.nodes.image;
    if (!imageType) {
      options.onError("当前编辑器不支持插入图片。");
      return;
    }
    const created = [];
    for (const payload of payloads) {
      const saved = await options.saveAttachment(payload);
      created.push(
        imageType.create({
          src: imageEditorUrl(options.notePath, saved.target),
          alt: saved.target.split("/").pop() || payload.name,
          title: "",
        }),
      );
    }
    nodes = created;
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (nodes.length === 0 || view.isDestroyed) {
    return;
  }

  const { state } = view;
  const pos = Math.min(Math.max(position, 0), state.doc.content.size);
  const transaction = state.tr.setSelection(
    TextSelection.near(state.doc.resolve(pos)),
  );
  for (const node of nodes) {
    transaction.replaceSelectionWith(node);
  }
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

async function insertFiles(
  view: EditorView,
  options: ImagePasteOptions,
  images: ReturnType<typeof collectClipboardImages>,
  position: number,
) {
  let payloads: AttachmentPayload[];
  try {
    payloads = await Promise.all(images.map(toAttachmentPayload));
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
    return;
  }
  await insertPayloads(view, options, payloads, position);
}

/**
 * 右键菜单里的"粘贴"走的是宿主剪贴板：那里可能是一张截图、一段文字，
 * 也可能两者都有。图片优先，返回 true 表示已经处理，调用方不必再贴文本。
 */
export async function pasteClipboardImage(
  view: EditorView,
  options: ImagePasteOptions,
  position = view.state.selection.from,
) {
  const readHostImage = options.readClipboardImage;
  if (!readHostImage) {
    return false;
  }
  const base64 = await readHostImage().catch(() => "");
  if (!base64) {
    return false;
  }
  await insertPayloads(
    view,
    options,
    [{ name: HOST_IMAGE_NAME, data: base64 }],
    position,
  );
  return true;
}

/**
 * 把剪贴板/拖放进来的图片存成笔记库里的附件，再插入普通 Markdown 图片节点。
 *
 * Crepe 自带的 uploader 会用 `blob:` URL 建节点，而应用 CSP 不允许 `blob:`，
 * 于是粘贴后既看不到图、保存时还会把临时地址写进笔记。这里改成先落盘、
 * 再用笔记库相对路径引用，笔记在 Obsidian 或其它编辑器里也能直接打开。
 *
 * 处理函数挂在 `editorViewOptionsCtx` 而不是 ProseMirror 插件上：视图层 props
 * 的优先级高于插件，否则 Crepe 的 upload 插件会先把同一张图抢走。
 */
export function imagePasteFeature(
  editor: Editor,
  options?: ImagePasteOptions,
) {
  if (!options) {
    return;
  }

  editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      handlePaste: (view, event) => {
        if (!view.editable) {
          return false;
        }
        if (selectionIsCode(view)) {
          return false;
        }
        const images = collectClipboardImages(event.clipboardData);
        if (images.length > 0) {
          event.preventDefault();
          void insertFiles(view, options, images, view.state.selection.from);
          return true;
        }
        // 只有"剪贴板里什么都没有"时才去问宿主，否则普通文本粘贴会被抢走。
        if (
          !options.readClipboardImage ||
          !clipboardLooksEmpty(event.clipboardData)
        ) {
          return false;
        }
        event.preventDefault();
        void pasteClipboardImage(view, options, view.state.selection.from);
        return true;
      },
      handleDrop: (view, event) => {
        if (!view.editable) {
          return false;
        }
        if (selectionIsCode(view)) {
          return false;
        }
        const images = collectClipboardImages(event.dataTransfer);
        if (images.length === 0) {
          return false;
        }
        event.preventDefault();
        const position =
          view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos ?? view.state.selection.from;
        void insertFiles(view, options, images, position);
        return true;
      },
    }));
  });
}
