import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { commandsCtx } from "@milkdown/kit/core";
import {
  headingSchema,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { replaceAll } from "@milkdown/kit/utils";
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
  insertTitleHeadingMarkdown,
} from "../lib/editorCommands";
import { toEditorMarkdown, toVaultMarkdown } from "../lib/markdown";
import {
  FormatContextToolbar,
  type FormatAction,
} from "./FormatContextToolbar";
import { NoteFindBar } from "./NoteFindBar";

export interface EditorHandle {
  jumpToHeading(text: string): void;
  setHeading(level: number | null): boolean;
  insertTitleHeading(): boolean;
}

interface EditorPaneProps {
  path: string;
  title: string;
  content: string;
  readOnly: boolean;
  onChange(markdown: string): void;
}

/**
 * Milkdown keeps the file format as Markdown while presenting a live rich
 * editing surface. Asset URLs are converted at the boundary and restored on save.
 */
export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(
  function EditorPane(
    { path, title, content, readOnly, onChange },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    const readOnlyRef = useRef(readOnly);
    const [formatMenu, setFormatMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);
    const showInlineTitle = !hasLeadingHeading(content);
    onChangeRef.current = onChange;
    readOnlyRef.current = readOnly;

    const setHeading = (level: number | null) => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return false;
      }

      return crepe.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        return level
          ? commands.call(setBlockTypeCommand.key, {
              nodeType: headingSchema.type(ctx),
              attrs: { level },
            })
          : commands.call(setBlockTypeCommand.key, {
              nodeType: paragraphSchema.type(ctx),
            });
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

    useImperativeHandle(ref, () => ({
      jumpToHeading(text: string) {
        const headings = rootRef.current?.querySelectorAll(
          "h1, h2, h3, h4, h5, h6",
        );
        const target = [...(headings || [])].find(
          (heading) => heading.textContent?.trim() === text.trim(),
        );
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      setHeading,
      insertTitleHeading,
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
        (event.target as HTMLElement).closest(".milkdown-code-block")
      ) {
        return;
      }

      if (/^[0-6]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setHeading(event.key === "0" ? null : Number(event.key));
      } else if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        event.stopPropagation();
        insertTitleHeading();
      }
    };

    const runFormatAction = (action: FormatAction) => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) {
        return;
      }

      crepe.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
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
          case "code":
            commands.call(toggleInlineCodeCommand.key);
            break;
          case "latex":
            // Crepe registers this command by name inside its LaTeX feature.
            commands.call("ToggleLatex");
            break;
          case "link":
            commands.call(toggleLinkCommand.key);
            break;
        }
      });
      setFormatMenu(null);
    };

    const showFormatMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        readOnlyRef.current ||
        !rootRef.current?.contains(target) ||
        target.closest(".milkdown-code-block, .cm-editor")
      ) {
        return;
      }

      event.preventDefault();
      setFormatMenu({
        x: event.clientX,
        y: event.clientY + 8,
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
      const root = rootRef.current;
      if (!root) {
        return;
      }

      root.innerHTML = "";
      const crepe = new Crepe({
        root,
        defaultValue: toEditorMarkdown(content, path),
        features: {
          // Formatting is opened intentionally with the editor context menu.
          [CrepeFeature.Toolbar]: false,
          // Keep blank paragraphs free of Crepe's English placeholder so the
          // editing rhythm matches Obsidian.
          [CrepeFeature.Placeholder]: false,
        },
        featureConfigs: {
          [CrepeFeature.CodeMirror]: {
            theme: codeBlockTheme,
          },
        },
      }).setReadonly(readOnlyRef.current);
      crepeRef.current = crepe;

      crepe
        .create()
        .then(() => {
          if (crepeRef.current !== crepe) {
            return;
          }

          // Apply the latest mode after async initialization so a fast toggle
          // cannot leave the Markdown view in the wrong editability state.
          crepe.setReadonly(readOnlyRef.current);
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
              onChangeRef.current(toVaultMarkdown(markdown));
            });
          });
        })
        .catch((error) => {
          console.error("Failed to create Markdown editor", error);
        });

      return () => {
        if (crepeRef.current === crepe) {
          crepeRef.current = null;
        }
        crepe.destroy();
      };
    }, [path]);

    useEffect(() => {
      crepeRef.current?.setReadonly(readOnly);
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
          onKeyDown={handleEditorKeyDown}
          onPointerDown={() => setFormatMenu(null)}
          onWheel={() => setFormatMenu(null)}
        />
        {formatMenu ? (
          <FormatContextToolbar
            x={formatMenu.x}
            y={formatMenu.y}
            onAction={runFormatAction}
          />
        ) : null}
      </div>
    );
  },
);
