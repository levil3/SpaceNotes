import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  addBlockTypeCommand,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  createCodeBlockCommand,
  headingSchema,
  hrSchema,
  liftListItemCommand,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  createTable,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { replaceAll } from "@milkdown/kit/utils";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { codeBlockTheme } from "../lib/codeTheme";
import {
  hasLeadingHeading,
  headingLevelFromShortcut,
  insertTitleHeadingMarkdown,
  normalizeEditorLinkTarget,
  type EditorLinkTargetKind,
} from "../lib/editorCommands";
import {
  clearMermaidPreviews,
  isMermaidLanguage,
  refreshMermaidPreviews,
  renderMermaidPreview,
} from "../lib/mermaid";
import { toEditorMarkdown, toVaultMarkdown } from "../lib/markdown";
import { obsidianHighlightFeature } from "../lib/obsidianHighlightFeature";
import { markdownFidelityFeature } from "../lib/markdownFidelity";
import {
  FormatContextToolbar,
  type FormatAction,
  type FormatMenuContext,
} from "./FormatContextToolbar";
import { NoteFindBar } from "./NoteFindBar";

export interface EditorHandle {
  jumpToHeading(text: string, occurrence?: number): void;
  setHeading(level: number | null): boolean;
  insertTitleHeading(): boolean;
  loadExternalContent(markdown: string): void;
}

interface EditorPaneProps {
  path: string;
  title: string;
  content: string;
  readOnly: boolean;
  onChange(markdown: string): void;
  onZoom(step: -1 | 1): void;
}

interface LinkDialogState {
  kind: EditorLinkTargetKind;
  x: number;
  y: number;
  from: number;
  to: number;
  selectedText: string;
}

interface ProseMirrorNodeViewElement extends HTMLElement {
  pmViewDesc?: {
    node?: {
      attrs?: {
        language?: unknown;
      };
    };
    spec?: {
      cm?: {
        dispatch: (transaction: {
          selection: { anchor: number };
        }) => void;
        focus: () => void;
        posAtCoords: (coords: {
          x: number;
          y: number;
        }) => number | null;
      };
      initialized?: boolean;
      initializeCodeMirror?: () => void;
      update?: (node: unknown) => boolean;
    };
  };
}

const CALLOUT_MARKER = "[!note]";

/**
 * Crepe stores editability inside each code block's nested CodeMirror
 * compartment. ProseMirror does not update those node views when only the
 * outer editor switches between reading and editing, so explicitly ask every
 * initialized block to synchronize with the current editor mode.
 */
function syncCodeBlockEditability(root: HTMLElement | null) {
  root
    ?.querySelectorAll<ProseMirrorNodeViewElement>(".milkdown-code-block")
    .forEach((block) => {
      const viewDesc = block.pmViewDesc;
      if (!viewDesc?.node || !viewDesc.spec?.initialized) {
        return;
      }
      viewDesc.spec.update?.(viewDesc.node);
    });
}

/**
 * Milkdown keeps the file format as Markdown while presenting a live rich
 * editing surface. Asset URLs are converted at the boundary and restored on save.
 */
export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(
  function EditorPane(
    { path, title, content, readOnly, onChange, onZoom },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    const onZoomRef = useRef(onZoom);
    const readOnlyRef = useRef(readOnly);
    const lastZoomAtRef = useRef(0);
    // Replacing the buffer from disk makes ProseMirror report a document
    // change. That echo must not be read as a user edit.
    const suppressEditEchoRef = useRef(false);
    const expectedExternalRef = useRef<string | null>(null);
    // Last markdown this editor handed to App, so the content prop coming back
    // as an echo does not get re-applied as "external" content.
    const lastEmittedMarkdownRef = useRef<string | null>(null);
    const applyExternalMarkdownRef = useRef<
      ((markdown: string) => boolean) | null
    >(null);
    // Crepe finishes creating asynchronously. An external update that lands
    // before the buffer exists is applied as soon as it does.
    const editorReadyRef = useRef(false);
    const pendingExternalRef = useRef<string | null>(null);
    const [formatMenu, setFormatMenu] = useState<{
      x: number;
      y: number;
      context: FormatMenuContext;
    } | null>(null);
    const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(
      null,
    );
    const [linkValue, setLinkValue] = useState("");
    const showInlineTitle = !hasLeadingHeading(content);
    onChangeRef.current = onChange;
    onZoomRef.current = onZoom;
    readOnlyRef.current = readOnly;

    const setHeading = (level: number | null) => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return false;
      }

      return crepe.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        const view = ctx.get(editorViewCtx);
        const applyBlockType = () =>
          level
            ? commands.call(setBlockTypeCommand.key, {
                nodeType: headingSchema.type(ctx),
                attrs: { level },
              })
            : commands.call(setBlockTypeCommand.key, {
                nodeType: paragraphSchema.type(ctx),
              });

        const beforeBlockChange = view.state.doc;
        if (applyBlockType() && view.state.doc !== beforeBlockChange) {
          return true;
        }

        // A list item must begin with a paragraph, so ProseMirror cannot turn
        // that paragraph into a heading in place. Lift nested list items until
        // the selected text becomes a top-level block, then retry the shortcut.
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const { $from } = view.state.selection;
          let insideList = false;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === "list_item") {
              insideList = true;
              break;
            }
          }
          const beforeLift = view.state.doc;
          if (
            !insideList ||
            !commands.call(liftListItemCommand.key) ||
            view.state.doc === beforeLift
          ) {
            return false;
          }
          const beforeHeading = view.state.doc;
          if (applyBlockType() && view.state.doc !== beforeHeading) {
            return true;
          }
        }
        return false;
      });
    };

    const insertTitleHeading = () => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return false;
      }

      const result = insertTitleHeadingMarkdown(crepe.getMarkdown(), title);
      if (!result.inserted) {
        return false;
      }

      crepe.editor.action(replaceAll(result.markdown, true));
      return true;
    };

    const applyExternalMarkdown = (markdown: string) => {
      const crepe = crepeRef.current;
      if (!crepe || !editorReadyRef.current) {
        return false;
      }
      suppressEditEchoRef.current = true;
      try {
        crepe.editor.action(
          replaceAll(toEditorMarkdown(markdown, path), true),
        );
      } finally {
        suppressEditEchoRef.current = false;
      }
      // A listener that fires asynchronously still describes the text we just
      // pushed in, so it must not be forwarded as an edit.
      expectedExternalRef.current = toVaultMarkdown(crepe.getMarkdown());
      return true;
    };

    applyExternalMarkdownRef.current = applyExternalMarkdown;

    useImperativeHandle(ref, () => ({
      jumpToHeading(text: string, occurrence = 0) {
        // Outline text is raw Markdown ("## **重点**") while the rendered
        // heading only carries its text content, so compare normalized forms.
        const normalize = (value: string) =>
          value.replace(/[*_`~]/g, "").trim();
        const headings = [
          ...(rootRef.current?.querySelectorAll<HTMLElement>(
            "h1, h2, h3, h4, h5, h6",
          ) || []),
        ];
        const wanted = normalize(text);
        const matches = headings.filter(
          (heading) => normalize(heading.textContent || "") === wanted,
        );
        const target =
          matches[
            Math.min(Math.max(occurrence, 0), matches.length - 1)
          ];
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      setHeading,
      insertTitleHeading,
      // Replaces the buffer with what is now on disk. Deliberately silent: the
      // file did not change because of anything typed here, so nothing may be
      // written back or reported as an unsaved edit.
      loadExternalContent(markdown: string) {
        if (!applyExternalMarkdown(markdown)) {
          pendingExternalRef.current = markdown;
        }
      },
    }));

    // Heading shortcuts stay inside the editor so the same key combinations
    // remain available to inputs and dialogs elsewhere in the application.
    const handleEditorKeyDown = (
      event: ReactKeyboardEvent<HTMLDivElement>,
    ) => {
      setFormatMenu(null);
      if (readOnlyRef.current || event.nativeEvent.isComposing) {
        return;
      }

      const command = event.ctrlKey || event.metaKey;
      if (
        !command ||
        event.altKey ||
        (event.target as HTMLElement).closest(
          ".milkdown-code-block, .cm-editor",
        )
      ) {
        return;
      }

      const headingLevel = headingLevelFromShortcut(event);
      if (headingLevel !== null) {
        event.preventDefault();
        event.stopPropagation();
        setHeading(headingLevel === 0 ? null : headingLevel);
      } else if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        event.stopPropagation();
        insertTitleHeading();
      }
    };

    const writeClipboardText = async (text: string) => {
      if (window.levilNotes?.writeClipboardText) {
        await window.levilNotes.writeClipboardText(text);
        return;
      }
      await navigator.clipboard.writeText(text);
    };

    const readClipboardText = async () => {
      if (window.levilNotes?.readClipboardText) {
        return window.levilNotes.readClipboardText();
      }
      return navigator.clipboard.readText();
    };

    const openLinkDialog = (kind: EditorLinkTargetKind) => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return;
      }

      const selection = crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        return {
          from,
          to,
          selectedText: view.state.doc.textBetween(from, to, " "),
        };
      });
      setLinkValue("");
      setLinkDialog({
        kind,
        x: formatMenu?.x ?? window.innerWidth / 2,
        y: formatMenu?.y ?? window.innerHeight / 2,
        ...selection,
      });
      setFormatMenu(null);
    };

    const submitLink = () => {
      const crepe = crepeRef.current;
      if (!crepe || !linkDialog || readOnlyRef.current) {
        return;
      }

      const href = normalizeEditorLinkTarget(linkValue, linkDialog.kind);
      if (!href) {
        return;
      }
      const rawTarget = linkValue.trim().replace(/^\[\[|\]\]$/g, "");
      const linkText =
        linkDialog.selectedText ||
        (linkDialog.kind === "internal"
          ? rawTarget.split("#")[0] || href
          : rawTarget);

      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const linkMark = linkSchema.type(ctx).create({ href });
        const { from, to } = linkDialog;
        const transaction = view.state.tr;

        transaction.replaceWith(
          from,
          to,
          view.state.schema.text(linkText, [linkMark]),
        );
        view.dispatch(transaction.scrollIntoView());
        view.focus();
      });
      setLinkDialog(null);
      setLinkValue("");
    };

    const applyEditorAction = (action: FormatAction) => {
      switch (action) {
        case "paragraph":
          setHeading(null);
          return;
        case "heading-1":
        case "heading-2":
        case "heading-3":
        case "heading-4":
        case "heading-5":
        case "heading-6":
          setHeading(Number(action.slice(-1)));
          return;
        default:
          break;
      }

      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return;
      }
      crepe.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        const view = ctx.get(editorViewCtx);
        switch (action) {
          case "bold":
            commands.call(toggleStrongCommand.key);
            break;
          case "italic":
            commands.call(toggleEmphasisCommand.key);
            break;
          case "strikethrough":
            commands.call(toggleStrikethroughCommand.key);
            break;
          case "inline-code":
            commands.call(toggleInlineCodeCommand.key);
            break;
          case "inline-math":
            // Crepe registers this command by name inside its LaTeX feature.
            commands.call("ToggleLatex");
            break;
          case "blockquote":
            commands.call(wrapInBlockquoteCommand.key);
            break;
          case "bullet-list":
            commands.call(wrapInBlockTypeCommand.key, {
              nodeType: bulletListSchema.type(ctx),
            });
            break;
          case "ordered-list":
            commands.call(wrapInBlockTypeCommand.key, {
              nodeType: orderedListSchema.type(ctx),
            });
            break;
          case "task-list": {
            // Build the full bullet-list structure in one transaction. A
            // second transaction that mutates list_item.checked can leave
            // Crepe's Vue-backed list node view in a rerender loop.
            commands.call(wrapInBlockTypeCommand.key, {
              nodeType: listItemSchema.type(ctx),
              attrs: { checked: false },
            });
            break;
          }
          case "table":
            // A table is a top-level block. Clear the current text block before
            // inserting it so ProseMirror never receives a block inside a
            // paragraph, which would make the insertion command fail silently.
            commands.call(clearTextInCurrentBlockCommand.key);
            {
              const { from } = view.state.selection;
              commands.call(addBlockTypeCommand.key, {
                nodeType: createTable(ctx, 3, 3),
              });
              commands.call(selectTextNearPosCommand.key, { pos: from });
            }
            break;
          case "callout": {
            if (!commands.call(wrapInBlockquoteCommand.key)) {
              break;
            }
            const { $from } = view.state.selection;
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              if ($from.node(depth).type.name !== "blockquote") {
                continue;
              }
              const markerPosition = $from.start(depth) + 1;
              let transaction = view.state.tr.insertText(
                CALLOUT_MARKER,
                markerPosition,
              );
              // Obsidian callouts use a marker paragraph followed by the
              // actual content. Split the wrapped paragraph so the visible
              // marker remains stable and the user can type on the next line.
              const splitPosition =
                markerPosition + CALLOUT_MARKER.length;
              transaction = transaction.split(splitPosition);
              transaction = transaction.setSelection(
                TextSelection.near(
                  transaction.doc.resolve(splitPosition + 2),
                ),
              );
              view.dispatch(transaction.scrollIntoView());
              break;
            }
            break;
          }
          case "divider": {
            const { state } = view;
            const { $from } = state.selection;
            if (!$from.parent.isTextblock) {
              break;
            }

            // Insert the rule after the complete current block. This avoids
            // splitting text when the context menu was opened over a
            // selection, while also avoiding Milkdown's extra "<br />".
            const blockEnd = $from.after($from.depth);
            const divider = hrSchema.type(ctx).create();
            const trailingParagraph =
              blockEnd >= state.doc.content.size
                ? [paragraphSchema.type(ctx).create()]
                : [];
            const transaction = state.tr.insert(blockEnd, [
              divider,
              ...trailingParagraph,
            ]);
            view.dispatch(transaction.scrollIntoView());
            break;
          }
          case "code-block":
            commands.call(createCodeBlockCommand.key);
            break;
          case "math-block":
            commands.call(createCodeBlockCommand.key, "LaTeX");
            break;
        }
      });
    };

    const runClipboardAction = async (
      action: "cut" | "copy" | "paste" | "paste-plain" | "select-all",
      inCodeBlock: boolean,
    ) => {
      const crepe = crepeRef.current;
      if (!crepe) {
        return;
      }

      if (inCodeBlock) {
        if (action === "select-all") {
          document.execCommand("selectAll");
          return;
        }
        if (action === "copy" || action === "cut") {
          document.execCommand(action);
          return;
        }
        const text = await readClipboardText();
        if (text) {
          document.execCommand("insertText", false, text);
        }
        return;
      }

      if (action === "select-all") {
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(
            view.state.tr
              .setSelection(new AllSelection(view.state.doc))
              .scrollIntoView(),
          );
          view.focus();
        });
        return;
      }

      if (action === "copy" || action === "cut") {
        const selectedText = crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { from, to } = view.state.selection;
          return view.state.doc.textBetween(from, to, "\n");
        });
        if (!selectedText) {
          return;
        }
        await writeClipboardText(selectedText);
        if (action === "cut") {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
            view.focus();
          });
        }
        return;
      }

      const text = await readClipboardText();
      if (!text) {
        return;
      }
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.insertText(text).scrollIntoView(),
        );
        view.focus();
      });
    };

    const runFormatAction = (action: FormatAction) => {
      const menuContext = formatMenu?.context;
      setFormatMenu(null);
      if (
        action === "link" ||
        action === "external-link"
      ) {
        openLinkDialog(
          action === "link" ? "internal" : "external",
        );
        return;
      }
      if (
        action === "cut" ||
        action === "copy" ||
        action === "paste" ||
        action === "paste-plain" ||
        action === "select-all"
      ) {
        void runClipboardAction(
          action,
          menuContext?.inCodeBlock ?? false,
        );
        return;
      }
      applyEditorAction(action);
    };

    const showFormatMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!rootRef.current?.contains(target)) {
        return;
      }

      event.preventDefault();
      const inCodeBlock = Boolean(
        target.closest(".milkdown-code-block, .cm-editor"),
      );
      const crepe = crepeRef.current;
      const hasSelection = crepe
        ? crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            return (
              inCodeBlock ||
              !view.state.selection.empty
            );
          })
        : false;
      setFormatMenu({
        x: event.clientX,
        y: event.clientY + 8,
        context: {
          editable: !readOnlyRef.current,
          inCodeBlock,
          hasSelection,
        },
      });
    };

    useEffect(() => {
      if (!formatMenu) {
        return;
      }

      const closeMenu = (event: PointerEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".format-context-toolbar")) {
          setFormatMenu(null);
        }
      };
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setFormatMenu(null);
        }
      };
      const close = () => setFormatMenu(null);

      window.addEventListener("pointerdown", closeMenu, true);
      window.addEventListener("keydown", closeOnEscape, true);
      window.addEventListener("resize", close);
      return () => {
        window.removeEventListener("pointerdown", closeMenu, true);
        window.removeEventListener("keydown", closeOnEscape, true);
        window.removeEventListener("resize", close);
      };
    }, [formatMenu]);

    useEffect(() => {
      if (!linkDialog) {
        return;
      }

      const closeLinkDialog = (event: PointerEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".editor-link-popover")) {
          setLinkDialog(null);
          setLinkValue("");
        }
      };
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setLinkDialog(null);
          setLinkValue("");
          crepeRef.current?.editor.action((ctx) => {
            ctx.get(editorViewCtx).focus();
          });
        }
      };

      window.addEventListener("pointerdown", closeLinkDialog, true);
      window.addEventListener("keydown", closeOnEscape, true);
      return () => {
        window.removeEventListener("pointerdown", closeLinkDialog, true);
        window.removeEventListener("keydown", closeOnEscape, true);
      };
    }, [linkDialog]);

    useEffect(() => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      root.innerHTML = "";
      // Crepe's read-only node view removes the language picker entirely, so
      // the document model is the reliable source for classifying LaTeX blocks.
      let classifyTimer: number | null = null;
      const classifyPreviewBlocks = () => {
        let modelLanguages: string[] = [];
        try {
          modelLanguages =
            crepeRef.current?.editor.action((ctx) => {
              const languages: string[] = [];
              ctx
                .get(editorViewCtx)
                .state.doc.descendants((node) => {
                  if (node.type.name === "code_block") {
                    languages.push(String(node.attrs.language ?? ""));
                  }
                });
              return languages;
            }) ?? [];
        } catch {
          // The editor can be mid-teardown while a queued frame is running.
        }

        root
          .querySelectorAll<HTMLElement>(".milkdown-code-block")
          .forEach((block, index) => {
            const viewLanguage = String(
              (block as ProseMirrorNodeViewElement).pmViewDesc?.node?.attrs
                ?.language ?? "",
            );
            const pickerLanguage =
              block
                .querySelector(".language-button")
                ?.textContent?.trim() || "";
            const language = (
              viewLanguage || modelLanguages[index] || pickerLanguage
            ).toLocaleLowerCase();
            block.classList.toggle(
              "is-latex-block",
              language === "latex" || language === "math",
            );
            block.classList.toggle(
              "is-mermaid-block",
              isMermaidLanguage(language),
            );
            // Crepe normally waits for a code block to become visible before
            // creating its preview. Mermaid is document content rather than
            // editable source, so initialize it eagerly and show the diagram
            // as soon as the note opens.
            const spec = (block as ProseMirrorNodeViewElement).pmViewDesc?.spec;
            if (
              isMermaidLanguage(language) &&
              spec?.initializeCodeMirror &&
              !spec.initialized
            ) {
              spec.initializeCodeMirror();
            }
          });
      };
      const scheduleBlockClassification = () => {
        if (classifyTimer !== null) {
          return;
        }
        // ProseMirror attaches its node view metadata after inserting the DOM.
        // A task-level delay also keeps classification working when the window
        // is backgrounded and animation frames are throttled.
        classifyTimer = window.setTimeout(() => {
          classifyTimer = null;
          classifyPreviewBlocks();
        }, 50);
      };
      /**
       * Code blocks are initialized lazily when they enter the viewport.
       * Initializing on pointer entry as well keeps the language and copy
       * toolbar available even when the pointer lands on an empty line.
       */
      const initializeHoveredCodeBlock = (event: PointerEvent) => {
        const block = (event.target as HTMLElement).closest<
          ProseMirrorNodeViewElement
        >(".milkdown-code-block");
        const spec = block?.pmViewDesc?.spec;
        if (!block || !spec?.initializeCodeMirror || spec.initialized) {
          return;
        }
        spec.initializeCodeMirror();
        scheduleBlockClassification();
      };
      /**
       * When the first click initializes a placeholder code block, the browser
       * can keep focus on the outer ProseMirror editor. Focus CodeMirror after
       * creation and restore the caret at the clicked empty-line position.
       */
      const placeCodeBlockCaretOnFirstClick = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }
        const target = event.target as HTMLElement;
        if (
          !target.closest(
            ".cm-line, .milkdown-code-block-placeholder, .preview-panel",
          )
        ) {
          return;
        }
        const block = target.closest<ProseMirrorNodeViewElement>(
          ".milkdown-code-block",
        );
        const spec = block?.pmViewDesc?.spec;
        if (!block || !spec?.initializeCodeMirror || spec.initialized) {
          return;
        }
        spec.initializeCodeMirror();
        scheduleBlockClassification();
        const { clientX, clientY } = event;
        requestAnimationFrame(() => {
          const cm = spec.cm;
          if (!cm) {
            return;
          }
          cm.focus();
          const position = cm.posAtCoords({ x: clientX, y: clientY });
          if (position !== null && position >= 0) {
            cm.dispatch({ selection: { anchor: position } });
          }
        });
      };
      const blockObserver = new MutationObserver(
        scheduleBlockClassification,
      );
      blockObserver.observe(root, {
        childList: true,
        subtree: true,
      });
      const themeObserver = new MutationObserver(refreshMermaidPreviews);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });

      const handleEditorWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        event.preventDefault();
        const now = performance.now();
        if (now - lastZoomAtRef.current < 80) {
          return;
        }
        lastZoomAtRef.current = now;
        onZoomRef.current(event.deltaY < 0 ? 1 : -1);
      };
      root.addEventListener("wheel", handleEditorWheel, {
        passive: false,
        capture: true,
      });

      // Preview-backed code blocks (LaTeX and Mermaid) show one clear
      // representation at a time. Clicking the preview opens its source.
      const revealPreviewSource = (event: PointerEvent) => {
        const target = event.target as HTMLElement;
        root
          .querySelectorAll(".milkdown-code-block.is-preview-editing")
          .forEach((block) => {
            if (!block.contains(target)) {
              block.classList.remove("is-preview-editing");
            }
          });
        const preview = target.closest(".preview-panel");
        if (!preview || target.closest(".tools")) {
          return;
        }
        const block = preview.closest(".milkdown-code-block");
        if (!block) {
          return;
        }
        block.classList.add("is-preview-editing");
        requestAnimationFrame(() => {
          const source = block.querySelector(
            ".cm-content",
          ) as HTMLElement | null;
          source?.focus();
        });
      };
      const hidePreviewSource = (event: FocusEvent) => {
        const block = (event.target as HTMLElement).closest(
          ".milkdown-code-block",
        );
        if (!block) {
          return;
        }
        requestAnimationFrame(() => {
          if (!block.contains(document.activeElement)) {
            block.classList.remove("is-preview-editing");
          }
        });
      };
      root.addEventListener("pointerdown", revealPreviewSource, true);
      root.addEventListener(
        "pointerdown",
        placeCodeBlockCaretOnFirstClick,
        true,
      );
      root.addEventListener("focusout", hidePreviewSource, true);
      root.addEventListener("pointerover", initializeHoveredCodeBlock, true);

      const crepe = new Crepe({
        root,
        defaultValue: toEditorMarkdown(content, path),
        features: {
          // Formatting is opened intentionally with the editor context menu.
          [CrepeFeature.Toolbar]: false,
          // Keep blank paragraphs free of Crepe's English placeholder so the
          // editing rhythm matches Obsidian.
          [CrepeFeature.Placeholder]: false,
          // Crepe's block-image node stores its resize ratio in the Markdown
          // alt field, which overwrites image descriptions on every save.
          // CommonMark images preserve the original alt and title metadata.
          [CrepeFeature.ImageBlock]: false,
        },
        featureConfigs: {
          [CrepeFeature.CodeMirror]: {
            theme: codeBlockTheme,
            copyText: "复制",
            previewLoading: "正在渲染…",
            previewToggleText: (previewOnlyMode: boolean) =>
              previewOnlyMode ? "编辑" : "预览",
            searchPlaceholder: "搜索语言",
            noResultText: "没有匹配语言",
            renderPreview: (language: string, markdown: string) =>
              isMermaidLanguage(language)
                ? renderMermaidPreview(markdown)
                : null,
          },
        },
      }).setReadonly(readOnlyRef.current);
      // Obsidian 的 `==高亮==` 与仓库沿用的 `++高亮++` 需要在编辑器里成为
      // 真正的标记，否则会被当成普通字符原样显示。必须在 create() 之前注册。
      crepe.addFeature(obsidianHighlightFeature);
      // 正文里的 "[" 不应被转义，否则 Obsidian 的 [[wikilink]] 与 [^footnote]
      // 会失效，普通文本也会被悄悄改写。
      crepe.addFeature(markdownFidelityFeature);
      crepeRef.current = crepe;
      editorReadyRef.current = false;

      crepe
        .create()
        .then(() => {
          if (crepeRef.current !== crepe) {
            return;
          }

          // Apply the latest mode after async initialization so a fast toggle
          // cannot leave the Markdown view in the wrong editability state.
          crepe.setReadonly(readOnlyRef.current);
          syncCodeBlockEditability(root);
          scheduleBlockClassification();
          root.setAttribute("spellcheck", "false");
          root
            .querySelectorAll('[contenteditable="true"]')
            .forEach((element) =>
              element.setAttribute("spellcheck", "false"),
            );

          // Listen only after the initial document is ready, otherwise Milkdown
          // normalization can be mistaken for a user edit and auto-save the file.
          if (crepeRef.current !== crepe) {
            return;
          }
          crepe.on((listener) => {
            listener.markdownUpdated((_ctx, markdown) => {
              // A destroyed editor can finish an asynchronous update while the
              // next note is already active. Never forward that stale content.
              if (crepeRef.current !== crepe) {
                return;
              }
              if (suppressEditEchoRef.current) {
                return;
              }
              const vaultMarkdown = toVaultMarkdown(markdown);
              lastEmittedMarkdownRef.current = vaultMarkdown;
              if (expectedExternalRef.current === vaultMarkdown) {
                expectedExternalRef.current = null;
                return;
              }
              expectedExternalRef.current = null;
              onChangeRef.current(vaultMarkdown);
            });
          });

          // Anything that arrived while Crepe was still creating is applied
          // now, before the buffer is shown, so it never looks like a user edit.
          editorReadyRef.current = true;
          if (pendingExternalRef.current !== null) {
            const markdown = pendingExternalRef.current;
            pendingExternalRef.current = null;
            applyExternalMarkdown(markdown);
          }
        })
        .catch((error) => {
          console.error("Failed to create Markdown editor", error);
        });

      return () => {
        editorReadyRef.current = false;
        expectedExternalRef.current = null;
        applyExternalMarkdownRef.current = null;
        blockObserver.disconnect();
        themeObserver.disconnect();
        clearMermaidPreviews();
        if (classifyTimer !== null) {
          window.clearTimeout(classifyTimer);
        }
        root.removeEventListener("wheel", handleEditorWheel, true);
        root.removeEventListener(
          "pointerdown",
          revealPreviewSource,
          true,
        );
        root.removeEventListener(
          "pointerdown",
          placeCodeBlockCaretOnFirstClick,
          true,
        );
        root.removeEventListener(
          "focusout",
          hidePreviewSource,
          true,
        );
        root.removeEventListener(
          "pointerover",
          initializeHoveredCodeBlock,
          true,
        );
        if (crepeRef.current === crepe) {
          crepeRef.current = null;
        }
        crepe.destroy();
      };
    }, [path]);

    // The editor is keyed by note path, so re-opening the active note reuses
    // the mounted buffer. Disk content that is not just this editor's own echo
    // has to be pushed into the live buffer or the next save writes stale text.
    useEffect(() => {
      const apply = applyExternalMarkdownRef.current;
      const crepe = crepeRef.current;
      if (!apply || !crepe || !editorReadyRef.current) {
        return;
      }
      if (lastEmittedMarkdownRef.current === content) {
        return;
      }
      if (toVaultMarkdown(crepe.getMarkdown()) === content) {
        return;
      }
      apply(content);
    }, [content]);

    useEffect(() => {
      const crepe = crepeRef.current;
      if (!crepe) {
        return;
      }
      crepe.setReadonly(readOnly);
      syncCodeBlockEditability(rootRef.current);
    }, [readOnly]);

    return (
      <div className={`editor-mount ${readOnly ? "is-readonly" : ""}`}>
        <NoteFindBar documentRef={rootRef} content={content} />
        {showInlineTitle ? (
          <h1 className="note-inline-title" dir="auto">
            {title}
          </h1>
        ) : null}
        <div
          className="editor-content"
          ref={rootRef}
          spellCheck={false}
          onContextMenu={showFormatMenu}
          onKeyDownCapture={handleEditorKeyDown}
          onPointerDown={() => setFormatMenu(null)}
          onWheel={() => setFormatMenu(null)}
        />
        {formatMenu ? (
          <FormatContextToolbar
            x={formatMenu.x}
            y={formatMenu.y}
            context={formatMenu.context}
            onAction={runFormatAction}
          />
        ) : null}
        {linkDialog ? (
          <form
            className="editor-link-popover"
            style={{
              left: Math.min(linkDialog.x, window.innerWidth - 336),
              top: Math.min(linkDialog.y, window.innerHeight - 154),
            }}
            onSubmit={(event) => {
              event.preventDefault();
              submitLink();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <label htmlFor="editor-link-target">
              {linkDialog.kind === "internal"
                ? "笔记链接"
                : "外部链接"}
            </label>
            <input
              id="editor-link-target"
              autoFocus
              value={linkValue}
              placeholder={
                linkDialog.kind === "internal"
                  ? "输入笔记路径，例如 项目/方案"
                  : "输入网址，例如 https://example.com"
              }
              onChange={(event) => setLinkValue(event.target.value)}
            />
            <div className="editor-link-actions">
              <button
                type="button"
                onClick={() => {
                  setLinkDialog(null);
                  setLinkValue("");
                  crepeRef.current?.editor.action((ctx) => {
                    ctx.get(editorViewCtx).focus();
                  });
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!linkValue.trim()}
              >
                添加
              </button>
            </div>
          </form>
        ) : null}
      </div>
    );
  },
);
