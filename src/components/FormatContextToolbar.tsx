import {
  Bold,
  Code2,
  Italic,
  Link2,
  Sigma,
  Strikethrough,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export type FormatAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "latex"
  | "link";

interface FormatContextToolbarProps {
  x: number;
  y: number;
  onAction(action: FormatAction): void;
}

const COMMANDS: Array<{
  action: FormatAction;
  label: string;
  Icon: typeof Bold;
}> = [
  { action: "bold", label: "粗体", Icon: Bold },
  { action: "italic", label: "斜体", Icon: Italic },
  { action: "strikethrough", label: "删除线", Icon: Strikethrough },
  { action: "code", label: "行内代码", Icon: Code2 },
  { action: "latex", label: "行内公式", Icon: Sigma },
  { action: "link", label: "链接", Icon: Link2 },
];

export function FormatContextToolbar({
  x,
  y,
  onAction,
}: FormatContextToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) {
      return;
    }

    // Keep the toolbar inside the viewport when right-clicking near an edge.
    const margin = 8;
    const rect = toolbar.getBoundingClientRect();
    setPosition({
      left: Math.max(
        margin,
        Math.min(x, window.innerWidth - rect.width - margin),
      ),
      top: Math.max(
        margin,
        Math.min(y, window.innerHeight - rect.height - margin),
      ),
    });
  }, [x, y]);

  return (
    <div
      ref={toolbarRef}
      className="format-context-toolbar"
      role="toolbar"
      aria-label="文本格式"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {COMMANDS.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onAction(action)}
        >
          <Icon size={15} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
