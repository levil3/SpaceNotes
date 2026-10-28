import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  onSelect(): void;
  danger?: boolean;
  warning?: boolean;
}

export interface ContextMenuGroup {
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  groups: ContextMenuGroup[];
  label: string;
  caption?: string;
}

/**
 * Renders the shared file-tree context menu. The menu is measured before its
 * final position is applied so long Chinese labels never push it outside the
 * application window.
 */
export function ContextMenu({
  x,
  y,
  groups,
  label,
  caption,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const margin = 8;
    const rect = menu.getBoundingClientRect();
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
  }, [x, y, groups]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {caption ? (
        <div className="context-menu-caption">{caption}</div>
      ) : null}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group, groupIndex) => (
          <div
            className="context-menu-group"
            role="group"
            key={groupIndex}
          >
            {group.items.map((item) => (
              <button
                type="button"
                role="menuitem"
                key={item.id}
                className={
                  item.danger
                    ? "danger"
                    : item.warning
                      ? "warning"
                      : undefined
                }
                onClick={item.onSelect}
              >
                <item.Icon
                  size={16}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
