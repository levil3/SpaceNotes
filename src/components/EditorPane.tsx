import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { toEditorMarkdown, toVaultMarkdown } from "../lib/markdown";

export interface EditorHandle {
  jumpToHeading(text: string): void;
}

interface EditorPaneProps {
  path: string;
  title: string;
  content: string;
  readOnly: boolean;
  onChange(markdown: string): void;
}

function hasLeadingHeading(content: string) {
  const withoutFrontmatter = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trimStart();
  return /^#\s+\S/.test(withoutFrontmatter);
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
    const showInlineTitle = !hasLeadingHeading(content);
    onChangeRef.current = onChange;
    readOnlyRef.current = readOnly;

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
    }));

    useEffect(() => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      root.innerHTML = "";
      const crepe = new Crepe({
        root,
        defaultValue: toEditorMarkdown(content, path),
      }).setReadonly(readOnlyRef.current);
      crepeRef.current = crepe;

      crepe
        .create()
        .then(() => {
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
              onChangeRef.current(toVaultMarkdown(markdown));
            });
          });
        })
        .catch((error) => {
          console.error("Failed to create Markdown editor", error);
        });

      return () => {
        crepe.destroy();
        crepeRef.current = null;
      };
    }, [path]);

    useEffect(() => {
      crepeRef.current?.setReadonly(readOnly);
    }, [readOnly]);

    return (
      <div className={`editor-mount ${readOnly ? "is-readonly" : ""}`}>
        {showInlineTitle ? (
          <h1 className="note-inline-title" dir="auto">
            {title}
          </h1>
        ) : null}
        <div className="editor-content" ref={rootRef} spellCheck={false} />
      </div>
    );
  },
);
