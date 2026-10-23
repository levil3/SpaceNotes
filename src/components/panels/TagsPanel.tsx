import { Tags } from "lucide-react";
import type { TagResult } from "../../types";

interface TagsPanelProps {
  tags: TagResult[];
  onSelectTag(tag: string): void;
}

export function TagsPanel({ tags, onSelectTag }: TagsPanelProps) {
  return (
    <div className="side-panel-content">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">笔记库</span>
          <strong>标签</strong>
        </div>
        <span className="panel-meta">{tags.length} 个</span>
      </div>
      <div className="tag-list">
        {tags.length ? (
          tags.map((tag) => (
            <button
              type="button"
              className="tag-row"
              key={tag.tag}
              onClick={() => onSelectTag(tag.tag)}
            >
              <span className="tag-name">#{tag.tag}</span>
              <span className="tag-count">{tag.count}</span>
            </button>
          ))
        ) : (
          <div className="panel-empty">
            <Tags size={22} />
            <span>笔记库中还没有标签</span>
          </div>
        )}
      </div>
    </div>
  );
}
