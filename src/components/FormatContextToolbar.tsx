import {
  Bold,
  ChevronRight,
  ClipboardPaste,
  ClipboardType,
  Code2,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  MessageSquareQuote,
  Pilcrow,
  Scissors,
  SeparatorHorizontal,
  Sigma,
  SquareDashed,
  Strikethrough,
  Table2,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export type FormatAction =
  | "link"
  | "external-link"
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "inline-math"
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "blockquote"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "table"
  | "callout"
  | "divider"
  | "code-block"
  | "math-block"
  | "cut"
  | "copy"
  | "paste"
  | "paste-plain"
  | "select-all";

export interface FormatMenuContext {
  editable: boolean;
  inCodeBlock: boolean;
  hasSelection: boolean;
}

interface FormatContextToolbarProps {
  x: number;
  y: number;
  context: FormatMenuContext;
  onAction(action: FormatAction): void;
}

interface MenuEntry {
  action: FormatAction;
  label: string;
  Icon: LucideIcon;
  disabled?: boolean;
  children?: MenuEntry[];
}

const SUBMENU_WIDTH = 240;

/**
 * Groups follow Obsidian's editor context menu so frequently used formatting,
 * block-level commands, and clipboard operations remain easy to scan.
 */
function buildMenuGroups(context: FormatMenuContext): MenuEntry[][] {
  const canEdit = context.editable && !context.inCodeBlock;
  const textFormatItems: MenuEntry[] = [
    { action: "bold", label: "粗体", Icon: Bold, disabled: !canEdit },
    { action: "italic", label: "斜体", Icon: Italic, disabled: !canEdit },
    {
      action: "strikethrough",
      label: "删除线",
      Icon: Strikethrough,
      disabled: !canEdit,
    },
    {
      action: "inline-code",
      label: "行内代码",
      Icon: Code2,
      disabled: !canEdit,
    },
    {
      action: "inline-math",
      label: "行内公式",
      Icon: Sigma,
      disabled: !canEdit,
    },
  ];
  const paragraphItems: MenuEntry[] = [
    {
      action: "paragraph",
      label: "正文",
      Icon: Pilcrow,
      disabled: !canEdit,
    },
    {
      action: "heading-1",
      label: "标题 1",
      Icon: Heading1,
      disabled: !canEdit,
    },
    {
      action: "heading-2",
      label: "标题 2",
      Icon: Heading2,
      disabled: !canEdit,
    },
    {
      action: "heading-3",
      label: "标题 3",
      Icon: Heading3,
      disabled: !canEdit,
    },
    {
      action: "heading-4",
      label: "标题 4",
      Icon: Heading4,
      disabled: !canEdit,
    },
    {
      action: "heading-5",
      label: "标题 5",
      Icon: Heading5,
      disabled: !canEdit,
    },
    {
      action: "heading-6",
      label: "标题 6",
      Icon: Heading6,
      disabled: !canEdit,
    },
    {
      action: "blockquote",
      label: "引用",
      Icon: TextQuote,
      disabled: !canEdit,
    },
    {
      action: "bullet-list",
      label: "无序列表",
      Icon: List,
      disabled: !canEdit,
    },
    {
      action: "ordered-list",
      label: "有序列表",
      Icon: ListOrdered,
      disabled: !canEdit,
    },
    {
      action: "task-list",
      label: "任务列表",
      Icon: ListTodo,
      disabled: !canEdit,
    },
  ];
  const insertItems: MenuEntry[] = [
    { action: "table", label: "表格", Icon: Table2, disabled: !canEdit },
    {
      action: "callout",
      label: "标注",
      Icon: MessageSquareQuote,
      disabled: !canEdit,
    },
    {
      action: "divider",
      label: "分隔线",
      Icon: SeparatorHorizontal,
      disabled: !canEdit,
    },
    {
      action: "code-block",
      label: "代码块",
      Icon: Code2,
      disabled: !canEdit,
    },
    {
      action: "math-block",
      label: "数学块",
      Icon: SquareDashed,
      disabled: !canEdit,
    },
  ];

  return [
    [
      {
        action: "link",
        label: "新增笔记链接",
        Icon: Link2,
        disabled: !context.editable || context.inCodeBlock,
      },
      {
        action: "external-link",
        label: "新增外部链接",
        Icon: ExternalLink,
        disabled: !context.editable || context.inCodeBlock,
      },
    ],
    [
      {
        action: "bold",
        label: "文本格式",
        Icon: Bold,
        children: textFormatItems,
      },
      {
        action: "paragraph",
        label: "段落设置",
        Icon: Pilcrow,
        children: paragraphItems,
      },
      {
        action: "table",
        label: "插入",
        Icon: Table2,
        children: insertItems,
      },
    ],
    [
      {
        action: "cut",
        label: "剪切",
        Icon: Scissors,
        disabled: !context.hasSelection || !context.editable,
      },
      {
        action: "copy",
        label: "复制",
        Icon: Copy,
        disabled: !context.hasSelection,
      },
      {
        action: "paste",
        label: "粘贴",
        Icon: ClipboardPaste,
        disabled: !context.editable,
      },
      {
        action: "paste-plain",
        label: "以纯文本形式粘贴",
        Icon: ClipboardType,
        disabled: !context.editable,
      },
      {
        action: "select-all",
        label: "全选",
        Icon: SquareDashed,
      },
    ],
  ];
}

export function FormatContextToolbar({
  x,
  y,
  context,
  onAction,
}: FormatContextToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [openSubmenu, setOpenSubmenu] = useState<FormatAction | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  const [submenuOffsetTop, setSubmenuOffsetTop] = useState(-5);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) {
      return;
    }

    // Keep both the menu and its widest submenu inside the application window.
    const margin = 8;
    const rect = toolbar.getBoundingClientRect();
    const left = Math.max(
      margin,
      Math.min(x, window.innerWidth - rect.width - margin),
    );
    setPosition({
      left,
      top: Math.max(
        margin,
        Math.min(y, window.innerHeight - rect.height - margin),
      ),
    });
    setSubmenuSide(
      left + rect.width + SUBMENU_WIDTH + margin <= window.innerWidth
        ? "right"
        : "left",
    );
  }, [x, y]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const entry = toolbar?.querySelector(".format-context-menu-entry.is-open");
    const submenu = entry?.querySelector(".format-context-submenu");
    if (!entry || !submenu) {
      return;
    }

    const margin = 8;
    const entryRect = entry.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const viewportTop = margin - entryRect.top;
    const viewportBottom =
      window.innerHeight - margin - submenuRect.height - entryRect.top;
    setSubmenuOffsetTop(
      Math.max(viewportTop, Math.min(-5, viewportBottom)),
    );
  }, [openSubmenu, submenuSide]);

  const renderEntry = (
    entry: MenuEntry,
    isSubmenuEntry = false,
  ): JSX.Element => {
    const hasChildren = Boolean(entry.children?.length);
    const isOpen = openSubmenu === entry.action;

    return (
      <div
        key={entry.action}
        className={`format-context-menu-entry ${isOpen ? "is-open" : ""}`}
        onPointerEnter={
          isSubmenuEntry
            ? undefined
            : () => {
                // Leaf entries inside a submenu must not clear the parent
                // submenu while the pointer travels toward the command.
                if (hasChildren) {
                  setOpenSubmenu(entry.action);
                } else {
                  setOpenSubmenu(null);
                }
              }
        }
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup={hasChildren ? "menu" : undefined}
          aria-expanded={hasChildren ? isOpen : undefined}
          disabled={entry.disabled}
          onClick={() => {
            if (hasChildren) {
              setOpenSubmenu(isOpen ? null : entry.action);
              return;
            }
            onAction(entry.action);
          }}
        >
          <entry.Icon size={16} strokeWidth={1.7} aria-hidden="true" />
          <span>{entry.label}</span>
          {hasChildren ? (
            <ChevronRight
              className="format-context-menu-chevron"
              size={14}
              strokeWidth={1.7}
              aria-hidden="true"
            />
          ) : null}
        </button>
        {hasChildren && isOpen ? (
          <div
            className={`format-context-submenu is-${submenuSide}`}
            role="menu"
            aria-label={entry.label}
            style={{ top: submenuOffsetTop }}
          >
            {entry.children?.map((child) =>
              renderEntry(child, true),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={toolbarRef}
      className="format-context-toolbar"
      role="menu"
      aria-label="编辑菜单"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {buildMenuGroups(context).map((group, groupIndex) => (
        <div
          className="format-context-menu-group"
          role="group"
          key={groupIndex}
        >
          {group.map((entry) => renderEntry(entry))}
        </div>
      ))}
    </div>
  );
}
