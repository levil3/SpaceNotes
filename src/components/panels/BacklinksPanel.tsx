import { Link2 } from "lucide-react";
import type { BacklinkResult } from "../../types";

interface BacklinksPanelProps {
  title: string;
  backlinks: BacklinkResult[];
  onOpenNote(path: string): void;
}

export function BacklinksPanel({
  title,
  backlinks,
  onOpenNote,
}: BacklinksPanelProps) {
  return (
    <div className="side-panel-content">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">当前笔记</span>
          <strong>反向链接</strong>
        </div>
        <span className="panel-meta">{backlinks.length} 条</span>
      </div>
      <div className="outline-note-title">{title || "未打开笔记"}</div>
      <div className="panel-list">
        {backlinks.length ? (
          backlinks.map((backlink) => (
            <button
              key={backlink.path}
              type="button"
              className="backlink-row"
              onClick={() => onOpenNote(backlink.path)}
            >
              <strong>{backlink.title}</strong>
              <span>{backlink.snippet}</span>
            </button>
          ))
        ) : (
          <div className="panel-empty">
            <Link2 size={22} />
            <span>没有其他笔记引用当前笔记</span>
          </div>
        )}
      </div>
    </div>
  );
}
