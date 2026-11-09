import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectTreePaths,
  listAllTreeItems,
  listVisibleTreeItems,
  selectVisibleTreeRange,
  type FileTreeSelectionItem,
} from "../../lib/fileSelection";
import type { FileNode } from "../../lib/paths";
import { formatShortcut } from "../../lib/shortcutLabels";
import type { GitStatus, NoteFile } from "../../types";

interface FilePanelProps {
  files: NoteFile[];
  tree: FileNode[];
  activePath: string;
  gitStatus: GitStatus | null;
  /** Changes whenever the app wants the filter box focused (Ctrl+P). */
  filterFocusRequest: number;
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
  filterFocusRequest,
  onCreateNote,
  onOpenNote,
  onContextMenu,
}: FilePanelProps) {
  const [filter, setFilter] = useState("");
  // Top-level folders are expanded by default, deeper folders stay collapsed
  // until opened. Keeping the two overrides separate means a tree refresh (or
  // a vault switch) cannot resurrect folders the user collapsed.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const filterInputRef = useRef<HTMLInputElement>(null);
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
  const openFolders = useMemo(() => {
    const paths = new Set<string>();
    const visit = (nodes: FileNode[], depth: number) => {
      for (const node of nodes) {
        if (node.type !== "folder") {
          continue;
        }
        const isOpen =
          depth === 0
            ? !collapsedFolders.has(node.path)
            : expandedFolders.has(node.path);
        if (!isOpen) {
          continue;
        }
        paths.add(node.path);
        visit(node.children, depth + 1);
      }
    };
    visit(filteredTree, 0);
    return paths;
  }, [collapsedFolders, expandedFolders, filteredTree]);
  const visibleSelectionItems = useMemo(
    () => listVisibleTreeItems(filteredTree, openFolders),
    [filteredTree, openFolders],
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
    // A folder that was renamed or left the vault would otherwise keep a dead
    // key, and that folder would render collapsed forever.
    const folderPaths = new Set<string>();
    const collectFolders = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type !== "folder") {
          continue;
        }
        folderPaths.add(node.path);
        collectFolders(node.children);
      }
    };
    collectFolders(tree);
    const prune = (current: Set<string>) => {
      const next = new Set(
        [...current].filter((path) => folderPaths.has(path)),
      );
      return next.size === current.size ? current : next;
    };
    setCollapsedFolders(prune);
    setExpandedFolders(prune);
  }, [tree]);

  useEffect(() => {
    if (!filterFocusRequest) {
      return;
    }
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, [filterFocusRequest]);

  // Note changes that did not come from the tree (tab click, backlink, search
  // result, history) still have to move the tree selection onto that note.
  useEffect(() => {
    if (!activePath) {
      return;
    }
    setSelectedPaths((current) =>
      current.has(activePath) ? current : new Set([activePath]),
    );
    setSelectionAnchor(activePath);
  }, [activePath]);

  const toggleFolder = (path: string, depth: number) => {
    const update = (current: Set<string>) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    };
    if (depth === 0) {
      setCollapsedFolders(update);
    } else {
      setExpandedFolders(update);
    }
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
      const isOpen =
        depth === 0
          ? !collapsedFolders.has(node.path)
          : expandedFolders.has(node.path);
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
                toggleFolder(node.path, depth);
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
          ref={filterInputRef}
          autoFocus
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setSelectedPaths(new Set());
            setSelectionAnchor("");
          }}
          placeholder="按标题或路径筛选"
        />
        <kbd>{formatShortcut("Ctrl P")}</kbd>
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
            // Later Shift+click ranges must start from a visible row instead
            // of an anchor that may already be gone.
            setSelectionAnchor(visibleSelectionItems[0]?.path || "");
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
