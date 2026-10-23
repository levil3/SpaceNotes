import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import { useEffect, useState } from "react";
import { buildOutlineTree, type OutlineNode } from "../../lib/outline";
import type { OutlineEntry } from "../../types";

interface OutlinePanelProps {
  title: string;
  entries: OutlineEntry[];
  onJump(entry: OutlineEntry): void;
}

export function OutlinePanel({
  title,
  entries,
  onJump,
}: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = buildOutlineTree(entries);

  useEffect(() => {
    setCollapsed(new Set());
  }, [title]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderNode = (node: OutlineNode, depth = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    return (
      <div key={node.id}>
        <div className="outline-row" data-level={node.entry.level}>
          {hasChildren ? (
            <button
              type="button"
              className="outline-toggle"
              aria-expanded={!isCollapsed}
              aria-label={
                isCollapsed
                  ? `展开 ${node.entry.text}`
                  : `收起 ${node.entry.text}`
              }
              title={isCollapsed ? "展开子标题" : "收起子标题"}
              onClick={() => toggleCollapsed(node.id)}
            >
              {isCollapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          ) : (
            <span className="outline-toggle-placeholder" />
          )}
          <button
            type="button"
            className="outline-entry"
            title={node.entry.text}
            onClick={() => onJump(node.entry)}
          >
            <span>{node.entry.text}</span>
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <div className="outline-children" data-depth={depth + 1}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="side-panel-content">
      <div className="panel-list outline-list">
        {tree.length ? (
          tree.map((node) => renderNode(node))
        ) : (
          <div className="panel-empty">
            <ListTree size={22} />
            <span>当前笔记还没有标题</span>
          </div>
        )}
      </div>
    </div>
  );
}
