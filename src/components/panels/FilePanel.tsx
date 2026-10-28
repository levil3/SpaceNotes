import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  collectTreePaths,
  listAllTreeItems,
  listVisibleTreeItems,
  selectVisibleTreeRange,
  type FileTreeSelectionItem,
} from "../../lib/fileSelection";
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
    selection: FileTreeSelectionItem[],
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
  // Keep file-tree selection separate from the active note: a range can
  // include folders and files without opening every item in the range.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(activePath ? [activePath] : []),
  );
  const [selectionAnchor, setSelectionAnchor] = useState(activePath);

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
  const visibleSelectionItems = useMemo(
    () => listVisibleTreeItems(filteredTree, expanded),
    [expanded, filteredTree],
  );
  const allSelectionItems = useMemo(
    () => listAllTreeItems(tree),
    [tree],
  );

  useEffect(() => {
    const validPaths = collectTreePaths(tree);
    setSelectedPaths((current) => {
      const next = new Set(
        [...current].filter((path) => validPaths.has(path)),
      );
      return next.size === current.size ? current : next;
    });
    setSelectionAnchor((current) =>
      current && validPaths.has(current) ? current : "",
    );
  }, [tree]);

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

  const selectRow = (
    path: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (event.shiftKey) {
      setSelectedPaths(
        new Set(
          selectVisibleTreeRange(
            visibleSelectionItems,
            selectionAnchor || activePath,
            path,
          ),
        ),
      );
      return false;
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      setSelectionAnchor(path);
      return false;
    }

    setSelectedPaths(new Set([path]));
    setSelectionAnchor(path);
    return true;
  };

  const openContextMenu = (
    node: FileNode,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    // Preserve a multi-selection when its member is right-clicked; otherwise
    // right-clicking a different row starts a new single-item selection.
    const selection = selectedPaths.has(node.path)
      ? allSelectionItems.filter((item) => selectedPaths.has(item.path))
      : [{ path: node.path, kind: node.type }];
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(new Set([node.path]));
      setSelectionAnchor(node.path);
    }
    onContextMenu(node.path, node.type, event, selection);
  };

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    if (node.type === "folder") {
      const isOpen = expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            className={`tree-row folder-row ${
              selectedPaths.size > 1 && selectedPaths.has(node.path)
                ? "is-multi-selected"
                : ""
            }`}
            data-collapsed={!isOpen}
            aria-selected={selectedPaths.has(node.path)}
            style={
              {
                "--tree-indent": `${24 + depth * 17}px`,
              } as React.CSSProperties
            }
            onClick={(event) => {
              if (selectRow(node.path, event)) {
                toggleFolder(node.path);
              }
            }}
            onContextMenu={(event) => openContextMenu(node, event)}
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
        } ${
          selectedPaths.size > 1 && selectedPaths.has(node.path)
            ? "is-multi-selected"
            : ""
        } ${gitChange ? `git-kind-${gitChange.kind}` : ""}`}
        style={
          {
            "--tree-indent": `${24 + depth * 17}px`,
          } as React.CSSProperties
        }
        title={node.path}
        aria-selected={selectedPaths.has(node.path)}
        onClick={(event) => {
          if (selectRow(node.path, event)) {
            onOpenNote(node.path);
          }
        }}
        onContextMenu={(event) => openContextMenu(node, event)}
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
          onChange={(event) => {
            setFilter(event.target.value);
            setSelectedPaths(new Set());
            setSelectionAnchor("");
          }}
          placeholder="按标题或路径筛选"
        />
        <kbd>Ctrl P</kbd>
      </label>
      <div
        className="tree-scroll"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedPaths(new Set());
            setSelectionAnchor("");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSelectedPaths(new Set());
            setSelectionAnchor("");
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "a"
          ) {
            event.preventDefault();
            setSelectedPaths(
              new Set(visibleSelectionItems.map((item) => item.path)),
            );
          }
        }}
      >
        {filteredTree.length ? (
          filteredTree.map((node) => renderNode(node))
        ) : (
          <div className="panel-empty">
            <FileText size={22} />
            <span>没有匹配的笔记</span>
          </div>
        )}
      </div>
      <div className="panel-footer-note">
        {selectedPaths.size > 1
          ? `已选择 ${selectedPaths.size} 项 · `
          : ""}
        {files.length} 篇 Markdown 笔记
      </div>
    </div>
  );
}
