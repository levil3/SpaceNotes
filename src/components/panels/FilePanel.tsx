import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileNode } from "../../lib/paths";
import type { GitStatus, NoteFile } from "../../types";

interface FilePanelProps {
  files: NoteFile[];
  tree: FileNode[];
  activePath: string;
  gitStatus: GitStatus | null;
  onCreateNote(): void;
  onOpenNote(path: string): void;
  onContextMenu(
    path: string,
    kind: "file" | "folder",
    event: React.MouseEvent,
  ): void;
}

export function FilePanel({
  files,
  tree,
  activePath,
  gitStatus,
  onCreateNote,
  onOpenNote,
  onContextMenu,
}: FilePanelProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((node) => node.type === "folder").map((node) => node.path)),
  );

  const filteredTree = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) {
      return tree;
    }

    const filterNodes = (nodes: FileNode[]): FileNode[] =>
      nodes.flatMap<FileNode>((node) => {
        if (node.type === "file") {
          return node.path.toLocaleLowerCase().includes(query) ? [node] : [];
        }
        const children = filterNodes(node.children);
        return children.length ? [{ ...node, children }] : [];
      });
    return filterNodes(tree);
  }, [filter, tree]);
  const gitChangesByPath = useMemo(
    () =>
      new Map(
        (gitStatus?.changes || []).map((change) => [change.path, change]),
      ),
    [gitStatus?.changes],
  );

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    if (node.type === "folder") {
      const isOpen = expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            className="tree-row folder-row"
            data-collapsed={!isOpen}
            style={
              {
                "--tree-indent": `${24 + depth * 17}px`,
              } as React.CSSProperties
            }
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(event) =>
              onContextMenu(node.path, "folder", event)
            }
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="tree-label">{node.name}</span>
          </button>
          {isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }

    const gitChange = gitChangesByPath.get(node.path);
    return (
      <button
        type="button"
        key={node.path}
        className={`tree-row file-row ${
          node.path === activePath ? "active" : ""
        } ${gitChange ? `git-kind-${gitChange.kind}` : ""}`}
        style={
          {
            "--tree-indent": `${24 + depth * 17}px`,
          } as React.CSSProperties
        }
        title={node.path}
        onClick={() => onOpenNote(node.path)}
        onContextMenu={(event) =>
          onContextMenu(node.path, "file", event)
        }
      >
        <span className="tree-label">{node.name}</span>
        {gitChange ? (
          <span className="tree-git-code" title={gitChange.label}>
            {gitChange.code}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="side-panel-content">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">笔记库</span>
          <strong>文件</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreateNote}
        >
          <Plus size={16} />
        </button>
      </div>
      <label className="sidebar-filter">
        <span className="sr-only">筛选文件</span>
        <input
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="按标题或路径筛选"
        />
        <kbd>Ctrl P</kbd>
      </label>
      <div className="tree-scroll">
        {filteredTree.length ? (
          filteredTree.map((node) => renderNode(node))
        ) : (
          <div className="panel-empty">
            <FileText size={22} />
            <span>没有匹配的笔记</span>
          </div>
        )}
      </div>
      <div className="panel-footer-note">{files.length} 篇 Markdown 笔记</div>
    </div>
  );
}
