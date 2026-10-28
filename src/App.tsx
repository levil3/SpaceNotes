import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Copy,
  FilePenLine,
  FolderOpen,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  RotateCw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityRail } from "./components/ActivityRail";
import { DiffViewer } from "./components/DiffViewer";
import { EditorPane, type EditorHandle } from "./components/EditorPane";
import dogMark from "../resources/icon.svg";
import { GitIgnoreDialog } from "./components/GitIgnoreDialog";
import { ModalDialog } from "./components/ModalDialog";
import { TopBar } from "./components/TopBar";
import { BacklinksPanel } from "./components/panels/BacklinksPanel";
import { FilePanel } from "./components/panels/FilePanel";
import { GitPanel } from "./components/panels/GitPanel";
import { OutlinePanel } from "./components/panels/OutlinePanel";
import { SearchPanel } from "./components/panels/SearchPanel";
import { SettingsPanel } from "./components/panels/SettingsPanel";
import { TagsPanel } from "./components/panels/TagsPanel";
import {
  buildFileTree,
  parentFolder,
  remapPathAfterDirectoryRename,
} from "./lib/paths";
import type {
  AppSettings,
  BacklinkResult,
  GitIgnoreScope,
  GitStatus,
  NoteFile,
  OutlineEntry,
  SearchResult,
  SidebarPanel,
  TagResult,
  VaultSnapshot,
} from "./types";

type ActiveView =
  | { kind: "note" }
  | { kind: "commit-preview"; paths: string[]; diff: string }
  | { kind: "working-diff"; path: string; diff: string }
  | { kind: "commit-diff"; hash: string; diff: string };

type EditorMode = "edit" | "read";

// Existing and reopened notes start in a non-editable reading view. Newly
// created notes explicitly switch to edit mode, and each tab remembers its
// selected mode until it is closed.
const DEFAULT_EDITOR_MODE: EditorMode = "read";

type DialogState =
  | { kind: "create"; parent: string; value: string }
  | { kind: "rename"; path: string; value: string }
  | { kind: "rename-folder"; path: string; value: string }
  | { kind: "delete"; path: string }
  | { kind: "delete-folder"; path: string }
  | { kind: "git-discard"; path: string }
  | null;

const DEFAULT_SETTINGS: AppSettings = {
  appearanceRevision: 4,
  themeMode: "light",
  accent: "#4b708b",
  background: "#ffffff",
  textColor: "#333333",
  editorFontSize: 15,
  editorLineHeight: 1.8,
  contentWidth: 1200,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  showHiddenFiles: false,
  recentVault: "",
};

function entryName(relativePath: string) {
  return relativePath.split("/").pop() || relativePath;
}

function basename(relativePath: string) {
  return entryName(relativePath).replace(/\.md$/i, "");
}

function belongsToDirectory(relativePath: string, directory: string) {
  return (
    relativePath === directory ||
    relativePath.startsWith(`${directory}/`)
  );
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [booted, setBooted] = useState(false);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [tabs, setTabs] = useState<Array<{ path: string; title: string }>>([]);
  const [activePath, setActivePath] = useState("");
  const [activeContent, setActiveContent] = useState("");
  const [activePanel, setActivePanel] = useState<SidebarPanel>("files");
  const [activeView, setActiveView] = useState<ActiveView>({ kind: "note" });
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([]);
  const [tags, setTags] = useState<TagResult[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitIgnoreRevision, setGitIgnoreRevision] = useState(0);
  const [selectedGitPaths, setSelectedGitPaths] = useState<Set<string>>(
    new Set(),
  );
  const [commitMessage, setCommitMessage] = useState("");
  const [saveState, setSaveState] = useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    kind: "file" | "folder";
  } | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [ignoreDialog, setIgnoreDialog] = useState<{
    path: string;
    isDirectory: boolean;
    scope: GitIgnoreScope;
  } | null>(null);
  const [historyTrail, setHistoryTrail] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [searchSeed, setSearchSeed] = useState("");
  const [editorModes, setEditorModes] = useState<Record<string, EditorMode>>(
    {},
  );

  const editorRef = useRef<EditorHandle>(null);
  const editorMenuRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ path: string; content: string } | null>(null);
  // Directory mutations emit index events before their IPC calls resolve.
  // This guard prevents those intermediate snapshots from closing open tabs.
  const directoryTransitionRef = useRef<{
    kind: "rename" | "trash";
    path: string;
  } | null>(null);
  // Tracks the newest note request so a slower, stale read cannot replace it.
  const openRequestRef = useRef(0);
  const settingsLoadedRef = useRef(false);
  const didInitializeRef = useRef(false);
  const activePathRef = useRef("");
  const activeContentRef = useRef("");

  activePathRef.current = activePath;
  activeContentRef.current = activeContent;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<AppSettings>) => {
      setSettings((current) => ({ ...current, ...updates }));

      // Hidden entries affect the backend index, so persist this visibility
      // change immediately instead of waiting for the appearance debounce.
      if (typeof updates.showHiddenFiles === "boolean") {
        window.levilNotes
          .saveSettings({ showHiddenFiles: updates.showHiddenFiles })
          .catch((error) => {
            showToast(String(error instanceof Error ? error.message : error));
          });
      }
    },
    [showToast],
  );

  const applySettings = useCallback((next: AppSettings) => {
    const resolvedTheme =
      next.themeMode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next.themeMode;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.style.setProperty("--canvas", next.background);
    document.documentElement.style.setProperty("--user-text", next.textColor);
    document.documentElement.style.setProperty("--accent", next.accent);
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${next.editorFontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--editor-line-height",
      String(next.editorLineHeight),
    );
    document.documentElement.style.setProperty(
      "--content-width",
      `${next.contentWidth}px`,
    );
  }, []);

  const refreshGit = useCallback(async () => {
    try {
      const status = await window.levilNotes.gitStatus();
      setGitStatus(status);
      setSelectedGitPaths((current) => {
        const valid = new Set(status.changes.map((change) => change.path));
        return new Set([...current].filter((path) => valid.has(path)));
      });
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  }, [showToast]);

  const refreshVaultMetadata = useCallback(async (path: string) => {
    const [nextOutline, nextBacklinks] = await Promise.all([
      path ? window.levilNotes.getOutline(path) : Promise.resolve([]),
      path ? window.levilNotes.getBacklinks(path) : Promise.resolve([]),
    ]);
    setOutline(nextOutline);
    setBacklinks(nextBacklinks);
  }, []);

  const refreshTags = useCallback(async () => {
    setTags(await window.levilNotes.getTags());
  }, []);

  const openNote = useCallback(
    async (path: string, recordHistory = true) => {
      if (!path) {
        return;
      }

      const requestId = ++openRequestRef.current;
      const pending = pendingSaveRef.current;
      if (pending) {
        await window.levilNotes.writeNote(pending.path, pending.content);
        pendingSaveRef.current = null;
      }

      try {
        const document = await window.levilNotes.readNote(path);
        if (requestId !== openRequestRef.current) {
          return;
        }
        const note = vault?.files.find((file) => file.path === path);
        const title = note?.title || basename(path);
        setActivePath(path);
        setActiveContent(document.content);
        setActiveView({ kind: "note" });
        setSaveState("saved");
        setTabs((current) =>
          current.some((tab) => tab.path === path)
            ? current
            : [...current, { path, title }],
        );
        await refreshVaultMetadata(path);

        if (recordHistory) {
          setHistoryTrail((current) => {
            const clipped = current.slice(0, historyIndex + 1);
            return clipped[clipped.length - 1] === path
              ? clipped
              : [...clipped, path];
          });
          setHistoryIndex((current) =>
            Math.min(current + 1, historyTrail.length),
          );
        }
      } catch (error) {
        showToast(String(error instanceof Error ? error.message : error));
      }
    },
    [historyIndex, historyTrail.length, refreshVaultMetadata, showToast, vault],
  );

  const initializeVault = useCallback(
    async (snapshot: VaultSnapshot) => {
      setVault(snapshot);
      await Promise.all([refreshTags(), refreshGit()]);
      if (!activePathRef.current && snapshot.files[0]) {
        await openNote(snapshot.files[0].path, true);
      }
    },
    [openNote, refreshGit, refreshTags],
  );

  useEffect(() => {
    if (didInitializeRef.current) {
      return;
    }
    didInitializeRef.current = true;
    let cancelled = false;
    window.levilNotes
      .getSettings()
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        applySettings(loaded);
        settingsLoadedRef.current = true;
        const snapshot = await window.levilNotes.restoreVault();
        if (!cancelled) {
          if (snapshot) {
            await initializeVault(snapshot);
          }
          setBooted(true);
        }
      })
      .catch((error) => {
        showToast(String(error));
        setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applySettings, initializeVault, showToast]);

  useEffect(() => {
    if (!vault) {
      return;
    }
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        title: vault.files.find((file) => file.path === tab.path)?.title || tab.title,
      })),
    );
  }, [vault]);

  useEffect(() => {
    const unsubscribe = window.levilNotes.onVaultChanged(async (snapshot) => {
      setVault(snapshot);
      await refreshTags();
      await refreshGit();
      const transition = directoryTransitionRef.current;
      const activePathInTransition =
        transition &&
        activePathRef.current &&
        belongsToDirectory(activePathRef.current, transition.path);
      if (
        activePathRef.current &&
        !activePathInTransition &&
        !snapshot.files.some((file) => file.path === activePathRef.current)
      ) {
        setTabs((current) =>
          current.filter((tab) => tab.path !== activePathRef.current),
        );
        setActivePath("");
        setActiveContent("");
        setActiveView({ kind: "note" });
      }
      if (activePathRef.current && !activePathInTransition) {
        await refreshVaultMetadata(activePathRef.current);
      }
    });
    return unsubscribe;
  }, [refreshGit, refreshTags, refreshVaultMetadata]);

  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return;
    }
    applySettings(settings);
    const timer = window.setTimeout(() => {
      window.levilNotes.saveSettings(settings).catch((error) => {
        showToast(String(error));
      });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [applySettings, settings, showToast]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settings.themeMode === "system") {
        applySettings(settings);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [applySettings, settings]);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) {
      return;
    }
    setSaveState("saving");
    try {
      await window.levilNotes.writeNote(pending.path, pending.content);
      pendingSaveRef.current = null;
      setSaveState("saved");
      await refreshGit();
    } catch (error) {
      setSaveState("error");
      showToast(String(error instanceof Error ? error.message : error));
    }
  }, [refreshGit, showToast]);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
  }, []);

  const handleEditorChange = useCallback(
    (path: string, markdown: string) => {
      // Bind each editor update to the note that produced it. Without this
      // guard, a delayed update from the previous editor can overwrite the
      // note the user just opened.
      if (!path || path !== activePathRef.current) {
        return;
      }
      setActiveContent(markdown);
      setSaveState("dirty");
      pendingSaveRef.current = {
        path,
        content: markdown,
      };
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void flushPendingSave();
      }, 650);
    },
    [flushPendingSave],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (
        event.altKey &&
        !command &&
        !event.shiftKey &&
        ["1", "2", "3", "4", "5", "6", "7"].includes(event.key)
      ) {
        event.preventDefault();
        const panels: SidebarPanel[] = [
          "files",
          "outline",
          "search",
          "tags",
          "backlinks",
          "git",
          "settings",
        ];
        setActivePanel(panels[Number(event.key) - 1]);
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
        return;
      }

      if (!command) {
        if (event.key === "Escape") {
          setContextMenu(null);
          setEditorMenuOpen(false);
        }
        return;
      }

      const editorOwnsBoldShortcut =
        event.target instanceof Element &&
        Boolean(event.target.closest(".editor-mount .ProseMirror"));

      if (event.key.toLowerCase() === "b") {
        // Let Milkdown's Mod-b command format the note instead of toggling
        // the workspace sidebar while the editor owns keyboard focus.
        if (editorOwnsBoldShortcut) {
          return;
        }
        event.preventDefault();
        setSettings((current) => ({
          ...current,
          sidebarCollapsed: !current.sidebarCollapsed,
        }));
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushPendingSave();
      } else if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setActivePanel("search");
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
      } else if (event.shiftKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setActivePanel("git");
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
      } else if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setActivePanel("files");
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flushPendingSave]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      setContextMenu(null);
      if (
        !editorMenuRef.current?.contains(event.target as Node)
      ) {
        setEditorMenuOpen(false);
      }
    };
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, []);

  const chooseVault = async () => {
    await flushPendingSave();
    try {
      const snapshot = await window.levilNotes.chooseVault();
      if (snapshot) {
        setTabs([]);
        setActivePath("");
        setActiveContent("");
        setHistoryTrail([]);
        setHistoryIndex(-1);
        await initializeVault(snapshot);
      }
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const navigateHistory = async (direction: -1 | 1) => {
    const nextIndex = historyIndex + direction;
    const nextPath = historyTrail[nextIndex];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(nextIndex);
    await openNote(nextPath, false);
  };

  const activeFile = useMemo(
    () => vault?.files.find((file) => file.path === activePath),
    [activePath, vault],
  );
  const activeTitle = activeFile?.title || basename(activePath);
  const activeEditorMode: EditorMode = activePath
    ? editorModes[activePath] || DEFAULT_EDITOR_MODE
    : DEFAULT_EDITOR_MODE;
  const fileTree = useMemo(
    () => buildFileTree(vault?.files || [], vault?.directories || []),
    [vault?.directories, vault?.files],
  );

  const startNewNoteInFolder = (parent: string) => {
    setDialog({
      kind: "create",
      parent,
      value: "",
    });
  };

  const startNewNote = () => {
    startNewNoteInFolder(parentFolder(activePath));
  };

  const confirmDialog = async () => {
    if (!dialog) {
      return;
    }
    try {
      if (dialog.kind === "create") {
        const created = await window.levilNotes.createNote(
          dialog.parent,
          dialog.value,
        );
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
        setEditorModes((current) => ({
          ...current,
          [created.path]: "edit",
        }));
        await openNote(created.path);
      } else if (dialog.kind === "rename") {
        const result = await window.levilNotes.renameNote(
          dialog.path,
          dialog.value,
        );
        setTabs((current) =>
          current.map((tab) =>
            tab.path === dialog.path
              ? { path: result.path, title: dialog.value }
              : tab,
          ),
        );
        setEditorModes((current) => {
          const mode = current[dialog.path];
          if (!mode) {
            return current;
          }
          const next = { ...current, [result.path]: mode };
          delete next[dialog.path];
          return next;
        });
        if (activePath === dialog.path) {
          setActivePath(result.path);
          activePathRef.current = result.path;
        }
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
      } else if (dialog.kind === "rename-folder") {
        await flushPendingSave();
        directoryTransitionRef.current = {
          kind: "rename",
          path: dialog.path,
        };
        const result = await window.levilNotes.renameDirectory(
          dialog.path,
          dialog.value,
        );
        const remapPath = (path: string) =>
          remapPathAfterDirectoryRename(
            path,
            dialog.path,
            result.path,
          );
        setTabs((current) =>
          current.map((tab) => ({ ...tab, path: remapPath(tab.path) })),
        );
        setEditorModes((current) => {
          const next: Record<string, EditorMode> = {};
          Object.entries(current).forEach(([path, mode]) => {
            next[remapPath(path)] = mode;
          });
          return next;
        });
        setHistoryTrail((current) => current.map(remapPath));
        const nextActivePath = remapPath(activePath);
        cancelPendingSave();
        activePathRef.current = nextActivePath;
        if (nextActivePath !== activePath) {
          setActivePath(nextActivePath);
        }
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
        directoryTransitionRef.current = null;
      } else if (dialog.kind === "delete") {
        await window.levilNotes.trashNote(dialog.path);
        setTabs((current) =>
          current.filter((tab) => tab.path !== dialog.path),
        );
        setEditorModes((current) => {
          const next = { ...current };
          delete next[dialog.path];
          return next;
        });
        if (activePath === dialog.path) {
          setActivePath("");
          setActiveContent("");
          setActiveView({ kind: "note" });
        }
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
      } else if (dialog.kind === "delete-folder") {
        await flushPendingSave();
        directoryTransitionRef.current = {
          kind: "trash",
          path: dialog.path,
        };
        await window.levilNotes.trashDirectory(dialog.path);
        cancelPendingSave();
        const removedPrefix = `${dialog.path}/`;
        const belongsToDeletedFolder = (path: string) =>
          path === dialog.path || path.startsWith(removedPrefix);
        setTabs((current) =>
          current.filter((tab) => !belongsToDeletedFolder(tab.path)),
        );
        setEditorModes((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([path]) => !belongsToDeletedFolder(path),
            ),
          ),
        );
        const remainingHistory = historyTrail.filter(
          (path) => !belongsToDeletedFolder(path),
        );
        setHistoryTrail(remainingHistory);
        setHistoryIndex((current) =>
          Math.min(current, remainingHistory.length - 1),
        );
        if (belongsToDeletedFolder(activePath)) {
          setActivePath("");
          activePathRef.current = "";
          setActiveContent("");
          setActiveView({ kind: "note" });
        }
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
        directoryTransitionRef.current = null;
      } else if (dialog.kind === "git-discard") {
        await flushPendingSave();
        const status = await window.levilNotes.gitDiscard([dialog.path]);
        setGitStatus(status);
        setSelectedGitPaths((current) => {
          const next = new Set(current);
          next.delete(dialog.path);
          return next;
        });
        if (activePath === dialog.path) {
          await openNote(dialog.path, false);
        }
        showToast(`已撤销 ${dialog.path} 的未提交修改。`);
      }
      setDialog(null);
    } catch (error) {
      directoryTransitionRef.current = null;
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const closeTab = async (path: string) => {
    if (path === activePath) {
      await flushPendingSave();
    }
    setEditorModes((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    setTabs((current) => {
      const next = current.filter((tab) => tab.path !== path);
      if (path === activePath) {
        const fallback = next[next.length - 1];
        if (fallback) {
          void openNote(fallback.path);
        } else {
          setActivePath("");
          setActiveContent("");
        }
      }
      return next;
    });
  };

  const copyActiveNotePath = async () => {
    if (!activePath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activePath);
      showToast("已复制笔记路径。");
    } catch {
      showToast("复制笔记路径失败。");
    }
  };

  const toggleActiveEditorMode = () => {
    if (!activePath || activeView.kind !== "note") {
      return;
    }
    const nextMode: EditorMode =
      activeEditorMode === "edit" ? "read" : "edit";
    if (nextMode === "read") {
      void flushPendingSave();
    }
    setEditorModes((current) => ({
      ...current,
      [activePath]: nextMode,
    }));
  };

  const openWorkingDiff = async (path: string) => {
    try {
      const diff = await window.levilNotes.gitDiff(path);
      setActiveView({ kind: "working-diff", path, diff });
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const showCommit = async (hash: string) => {
    try {
      const diff = await window.levilNotes.gitShow(hash);
      setActiveView({ kind: "commit-diff", hash, diff });
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const previewCommit = async () => {
    const paths = (gitStatus?.changes || [])
      .filter(
        (change) =>
          selectedGitPaths.has(change.path) && !change.conflict,
      )
      .map((change) => change.path);
    if (!paths.length) {
      showToast("请先选择要提交的文件。");
      return;
    }

    setGitBusy(true);
    try {
      const diff = await window.levilNotes.gitPreviewCommit(paths);
      setActiveView({ kind: "commit-preview", paths, diff });
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const runGitAction = async (
    action: () => Promise<{ output: string; status: GitStatus }>,
  ) => {
    setGitBusy(true);
    try {
      const result = await action();
      setGitStatus(result.status);
      showToast(result.output || "操作完成");
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const commitChanges = async (pushAfter: boolean) => {
    setGitBusy(true);
    try {
      const result = await window.levilNotes.gitCommit(
        commitMessage,
        [...selectedGitPaths],
      );
      setGitStatus(result.status);
      setCommitMessage("");
      setSelectedGitPaths(new Set());
      setActiveView((current) =>
        current.kind === "commit-preview" ? { kind: "note" } : current,
      );
      showToast(result.output || "提交完成");
      if (pushAfter) {
        const pushResult = await window.levilNotes.gitPush();
        setGitStatus(pushResult.status);
        showToast(pushResult.output || "提交并推送完成");
      }
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const commitIgnoredRemovals = async () => {
    setGitBusy(true);
    try {
      const result = await window.levilNotes.gitCommit(
        "chore: stop tracking ignored paths",
        [],
      );
      setGitStatus(result.status);
      setSelectedGitPaths(new Set());
      showToast(result.output || "已提交忽略路径的停止跟踪记录。");
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const toggleStage = async (path: string, staged: boolean) => {
    setGitBusy(true);
    try {
      const status = await window.levilNotes.gitStage([path], !staged);
      setGitStatus(status);
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const runBranchAction = async (
    action: () => Promise<{
      output: string;
      status: GitStatus;
    }>,
  ) => {
    setGitBusy(true);
    try {
      const result = await action();
      setGitStatus(result.status);
      showToast(result.output || "分支操作完成");
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const applyIgnoreRule = async () => {
    if (!ignoreDialog) {
      return;
    }
    setGitBusy(true);
    try {
      const result = await window.levilNotes.gitAddIgnore({
        path: ignoreDialog.path,
        isDirectory: ignoreDialog.isDirectory,
        scope: ignoreDialog.scope,
      });
      setGitStatus(result.status);
      setGitIgnoreRevision((current) => current + 1);
      setIgnoreDialog(null);
      showToast(result.output);
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const removeIgnoreRule = async (scope: GitIgnoreScope, line: number) => {
    setGitBusy(true);
    try {
      const result = await window.levilNotes.gitRemoveIgnore(scope, line);
      setGitStatus(result.status);
      setGitIgnoreRevision((current) => current + 1);
      showToast(result.output);
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    } finally {
      setGitBusy(false);
    }
  };

  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = settings.sidebarWidth;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.min(430, Math.max(230, startWidth + moveEvent.clientX - startX));
      setSettings((current) => ({ ...current, sidebarWidth: width }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const updateSidebarPanel = (panel: SidebarPanel) => {
    setActivePanel(panel);
    if (settings.sidebarCollapsed) {
      setSettings((current) => ({ ...current, sidebarCollapsed: false }));
    }
  };

  const contextGitChange = contextMenu
    ? gitStatus?.changes.find((change) => change.path === contextMenu.path)
    : undefined;
  const canDiscardContextChange =
    contextMenu?.kind === "file" &&
    contextGitChange &&
    !contextGitChange.conflict &&
    ["modified", "deleted"].includes(contextGitChange.kind);

  if (!booted) {
    return (
      <div className="boot-screen">
        <img className="brand-mark large" src={dogMark} alt="" />
        <p>正在准备笔记库...</p>
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${settings.sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={
        {
          "--sidebar-width": `${settings.sidebarWidth}px`,
        } as React.CSSProperties
      }
    >
      <TopBar
        tabs={tabs}
        activePath={activePath}
        sidebarCollapsed={settings.sidebarCollapsed}
        onSelectTab={(path) => void openNote(path)}
        onCloseTab={(path) => void closeTab(path)}
        onToggleSidebar={() =>
          setSettings((current) => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
          }))
        }
        onNewNote={startNewNote}
        onShowVaultMenu={() => void chooseVault()}
      />

      <div className="app-body">
        <ActivityRail
          activePanel={activePanel}
          gitChanges={gitStatus?.changes.length || 0}
          onChange={updateSidebarPanel}
        />

        {!settings.sidebarCollapsed ? (
          <aside className="context-sidebar" aria-label="左侧内容面板">
            <div className="sidebar-toolbar">
              <button
                type="button"
                className="icon-button"
                title="后退"
                aria-label="后退"
                disabled={historyIndex <= 0}
                onClick={() => void navigateHistory(-1)}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="前进"
                aria-label="前进"
                disabled={historyIndex >= historyTrail.length - 1}
                onClick={() => void navigateHistory(1)}
              >
                <ArrowRight size={15} />
              </button>
              <div className="sidebar-vault-label" title={vault?.path}>
                {vault?.name || "没有打开的笔记库"}
              </div>
            </div>

            {activePanel === "files" ? (
              <FilePanel
                files={vault?.files || []}
                tree={fileTree}
                activePath={activePath}
                gitStatus={gitStatus}
                onCreateNote={startNewNote}
                onOpenNote={(path) => void openNote(path)}
                onContextMenu={(path, kind, event) => {
                  event.preventDefault();
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    path,
                    kind,
                  });
                }}
              />
            ) : activePanel === "outline" ? (
              <OutlinePanel
                title={activeTitle}
                entries={outline}
                onJump={(entry) => editorRef.current?.jumpToHeading(entry.text)}
              />
            ) : activePanel === "search" ? (
              <SearchPanel
                initialQuery={searchSeed}
                onOpenResult={(result: SearchResult) =>
                  void openNote(result.path)
                }
              />
            ) : activePanel === "tags" ? (
              <TagsPanel
                tags={tags}
                onSelectTag={(tag) => {
                  setSearchSeed(`#${tag}`);
                  setActivePanel("search");
                }}
              />
            ) : activePanel === "backlinks" ? (
              <BacklinksPanel
                title={activeTitle}
                backlinks={backlinks}
                onOpenNote={(path) => void openNote(path)}
              />
            ) : activePanel === "git" ? (
              <GitPanel
                status={gitStatus}
                activeNotePath={activePath}
                busy={gitBusy}
                selectedPaths={selectedGitPaths}
                commitMessage={commitMessage}
                ignoreRevision={gitIgnoreRevision}
                onSelectPaths={setSelectedGitPaths}
                onCommitMessageChange={setCommitMessage}
                onRefresh={() => void refreshGit()}
                onOpenDiff={(path) => void openWorkingDiff(path)}
                onOpenFile={(path) => void openNote(path)}
                onDiscard={(path) =>
                  setDialog({ kind: "git-discard", path })
                }
                onToggleStage={(path, staged) => void toggleStage(path, staged)}
                onPreviewCommit={() => void previewCommit()}
                onCommit={(pushAfter) => void commitChanges(pushAfter)}
                onFetch={() => void runGitAction(window.levilNotes.gitFetch)}
                onPull={() => void runGitAction(window.levilNotes.gitPull)}
                onPush={() => void runGitAction(window.levilNotes.gitPush)}
                onCreateBranch={(name) =>
                  void runBranchAction(() =>
                    window.levilNotes.gitCreateBranch(name),
                  )
                }
                onCheckoutBranch={(name) =>
                  void runBranchAction(() =>
                    window.levilNotes.gitCheckoutBranch(name),
                  )
                }
                onRemoveIgnore={(scope, line) =>
                  void removeIgnoreRule(scope, line)
                }
                onCommitIgnoredRemovals={() => void commitIgnoredRemovals()}
                onShowCommit={(hash) => void showCommit(hash)}
              />
            ) : (
              <SettingsPanel
                settings={settings}
                onChange={updateSettings}
              />
            )}

            <div
              className="sidebar-resize-handle"
              role="separator"
              aria-label="调整左侧栏宽度"
              onPointerDown={resizeSidebar}
            />
          </aside>
        ) : null}

        <main className="main-workspace">
          <div className="editor-toolbar">
            <button
              type="button"
              className="icon-button"
              title="后退"
              aria-label="后退"
              disabled={historyIndex <= 0}
              onClick={() => void navigateHistory(-1)}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="前进"
              aria-label="前进"
              disabled={historyIndex >= historyTrail.length - 1}
              onClick={() => void navigateHistory(1)}
            >
              <ArrowRight size={15} />
            </button>
            <div className="editor-breadcrumb">
              {vault ? (
                <>
                  <span>{vault.name}</span>
                  <ChevronRight size={12} />
                  <span>{activePath || "未打开笔记"}</span>
                </>
              ) : (
                <span>未打开笔记库</span>
              )}
            </div>
            <div className="editor-toolbar-actions" ref={editorMenuRef}>
              <button
                type="button"
                className="icon-button"
                title="刷新"
                aria-label="刷新"
                onClick={() => void refreshGit()}
              >
                <RotateCw size={14} />
              </button>
              <button
                type="button"
                className={`icon-button view-mode-button ${
                  activeEditorMode === "read" ? "is-reading" : ""
                }`}
                title={
                  activeEditorMode === "edit"
                    ? "切换到阅读模式"
                    : "切换到编辑模式"
                }
                aria-label={
                  activeEditorMode === "edit"
                    ? "切换到阅读模式"
                    : "切换到编辑模式"
                }
                aria-pressed={activeEditorMode === "read"}
                disabled={
                  !activePath || activeView.kind !== "note"
                }
                onClick={toggleActiveEditorMode}
              >
                {activeEditorMode === "edit" ? (
                  <BookOpen size={15} />
                ) : (
                  <Pencil size={15} />
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                aria-expanded={editorMenuOpen}
                onClick={() => {
                  setEditorMenuOpen((current) => !current);
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              {editorMenuOpen ? (
                <div
                  className="editor-toolbar-menu"
                  role="menu"
                  aria-label="笔记操作"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!activePath}
                    onClick={() => {
                      setEditorMenuOpen(false);
                      void copyActiveNotePath();
                    }}
                  >
                    <Copy size={14} />
                    <span>复制笔记路径</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!activePath}
                    onClick={() => {
                      setEditorMenuOpen(false);
                      void window.levilNotes.showInFolder(activePath);
                    }}
                  >
                    <FolderOpen size={14} />
                    <span>在资源管理器中显示</span>
                  </button>
                  <div
                    className="editor-toolbar-menu-separator"
                    role="separator"
                  />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!activePath}
                    onClick={() => {
                      setEditorMenuOpen(false);
                      void closeTab(activePath);
                    }}
                  >
                    <X size={14} />
                    <span>关闭当前标签</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <section className="note-stage">
            {!vault ? (
              <div className="welcome-panel">
                <div className="welcome-mark">
                  <BookOpen size={28} />
                </div>
                <h1>打开你的笔记库</h1>
                <p>
                  选择一个 Markdown 文件夹，或新建空文件夹作为笔记库。笔记、附件和 Git
                  历史始终保留在你的本地目录中。
                </p>
                <button
                  type="button"
                  className="primary-action large"
                  onClick={() => void chooseVault()}
                >
                  <FolderOpen size={16} />
                  打开或新建笔记库
                </button>
                <span className="welcome-compatibility">
                  也兼容 Obsidian 创建的 Markdown 笔记库
                </span>
              </div>
            ) : activeView.kind === "commit-preview" ? (
              <DiffViewer
                title="提交内容预览"
                subtitle={`${activeView.paths.length} 个文件 · ${
                  commitMessage.trim().split(/\r?\n/)[0] ||
                  "尚未填写提交说明"
                }`}
                diff={activeView.diff}
                mode="preview"
              />
            ) : activeView.kind === "working-diff" ? (
              <DiffViewer
                title={activeView.path}
                subtitle="工作区差异 · 点击左侧 Git 文件可切换"
                diff={activeView.diff}
                mode="working"
              />
            ) : activeView.kind === "commit-diff" ? (
              <DiffViewer
                title={`提交 ${activeView.hash.slice(0, 8)}`}
                subtitle="历史提交差异"
                diff={activeView.diff}
                mode="commit"
              />
            ) : activePath ? (
              <EditorPane
                ref={editorRef}
                key={activePath}
                path={activePath}
                title={activeTitle}
                content={activeContent}
                onChange={(markdown) =>
                  handleEditorChange(activePath, markdown)
                }
                readOnly={activeEditorMode === "read"}
              />
            ) : (
              <div className="empty-note-state">
                <FilePenLine size={28} />
                <h2>选择一篇笔记开始编辑</h2>
                <p>从左侧文件列表打开笔记，或者新建一篇 Markdown。</p>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={startNewNote}
                >
                  新建笔记
                </button>
              </div>
            )}
          </section>
        </main>
      </div>

      <footer className="statusbar">
        <div className="status-group">
          <span>{activeContent ? `${activeContent.length.toLocaleString()} 字符` : "0 字符"}</span>
          <span>UTF-8</span>
          <span>
            {activeEditorMode === "read" ? "阅读模式" : "实时预览"}
          </span>
        </div>
        <div className="status-group">
          <span className={`save-status ${saveState}`}>
            {saveState === "saved"
              ? "已保存"
              : saveState === "saving"
                ? "保存中..."
                : saveState === "dirty"
                  ? "未保存"
                  : "保存失败"}
          </span>
          <span>
            {gitStatus?.repository
              ? `${gitStatus.branch} ↑${gitStatus.ahead} ↓${gitStatus.behind}`
              : "未连接 Git"}
          </span>
          <button
            type="button"
            className="status-sidebar-button"
            title="收起或展开侧栏"
            aria-label="收起或展开侧栏"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                sidebarCollapsed: !current.sidebarCollapsed,
              }))
            }
          >
            <PanelLeftClose size={13} />
          </button>
        </div>
      </footer>

      {toast ? <div className="toast">{toast}</div> : null}

      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === "file" ? (
            <button
              type="button"
              onClick={() => {
                void openNote(contextMenu.path);
                setContextMenu(null);
              }}
            >
              打开
            </button>
          ) : null}
          {contextMenu.kind === "folder" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  startNewNoteInFolder(contextMenu.path);
                  setContextMenu(null);
                }}
              >
                在此文件夹中新建笔记
              </button>
              <button
                type="button"
                onClick={() => {
                  setDialog({
                    kind: "rename-folder",
                    path: contextMenu.path,
                    value: entryName(contextMenu.path),
                  });
                  setContextMenu(null);
                }}
              >
                重命名文件夹
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void window.levilNotes.showInFolder(contextMenu.path);
              setContextMenu(null);
            }}
          >
            在资源管理器中显示
          </button>
          {canDiscardContextChange ? (
            <button
              type="button"
              className="warning"
              onClick={() => {
                setDialog({
                  kind: "git-discard",
                  path: contextMenu.path,
                });
                setContextMenu(null);
              }}
            >
              撤销未提交修改
            </button>
          ) : null}
          {gitStatus?.repository ? (
            <button
              type="button"
              onClick={() => {
                setIgnoreDialog({
                  path: contextMenu.path,
                  isDirectory: contextMenu.kind === "folder",
                  scope: "project",
                });
                setContextMenu(null);
              }}
            >
              忽略此{contextMenu.kind === "folder" ? "文件夹" : "文件"}...
            </button>
          ) : null}
          {contextMenu.kind === "file" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDialog({
                    kind: "rename",
                    path: contextMenu.path,
                    value: basename(contextMenu.path),
                  });
                  setContextMenu(null);
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setDialog({ kind: "delete", path: contextMenu.path });
                  setContextMenu(null);
                }}
              >
                移到回收站
              </button>
            </>
          ) : null}
          {contextMenu.kind === "folder" ? (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setDialog({
                  kind: "delete-folder",
                  path: contextMenu.path,
                });
                setContextMenu(null);
              }}
            >
              删除文件夹
            </button>
          ) : null}
        </div>
      ) : null}

      {dialog ? (
        <ModalDialog
          title={
            dialog.kind === "create"
              ? "新建笔记"
              : dialog.kind === "rename"
                ? "重命名笔记"
                : dialog.kind === "rename-folder"
                  ? "重命名文件夹"
                  : dialog.kind === "delete-folder"
                    ? "删除文件夹"
                    : dialog.kind === "git-discard"
                      ? "撤销未提交修改"
                      : "移到回收站"
          }
          description={
            dialog.kind === "delete"
              ? `确定要将“${basename(dialog.path)}”移到回收站吗？`
              : dialog.kind === "delete-folder"
                ? `确定要将“${entryName(dialog.path)}”文件夹及其中的全部内容移到回收站吗？`
                : dialog.kind === "git-discard"
                  ? `将丢弃“${dialog.path}”的暂存和工作区修改，并恢复到最近一次提交。此操作无法撤销。`
                  : undefined
          }
          inputLabel={
            dialog.kind === "rename-folder"
              ? "文件夹名称"
              : dialog.kind === "create" || dialog.kind === "rename"
                ? "笔记名称"
                : undefined
          }
          value={
            dialog.kind === "create" ||
            dialog.kind === "rename" ||
            dialog.kind === "rename-folder"
              ? dialog.value
              : undefined
          }
          placeholder={
            dialog.kind === "rename-folder"
              ? "输入文件夹名称"
              : "输入 Markdown 笔记名称"
          }
          confirmText={
            dialog.kind === "delete" || dialog.kind === "delete-folder"
              ? "移到回收站"
              : dialog.kind === "git-discard"
                ? "撤销修改"
                : "确定"
          }
          danger={
            dialog.kind === "delete" ||
            dialog.kind === "delete-folder" ||
            dialog.kind === "git-discard"
          }
          onValueChange={(value) =>
            setDialog((current) =>
              current &&
              (current.kind === "create" ||
                current.kind === "rename" ||
                current.kind === "rename-folder")
                ? { ...current, value }
                : current,
            )
          }
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirmDialog()}
        />
      ) : null}

      {ignoreDialog ? (
        <GitIgnoreDialog
          path={ignoreDialog.path}
          isDirectory={ignoreDialog.isDirectory}
          scope={ignoreDialog.scope}
          busy={gitBusy}
          onScopeChange={(scope) =>
            setIgnoreDialog((current) =>
              current ? { ...current, scope } : current,
            )
          }
          onCancel={() => setIgnoreDialog(null)}
          onConfirm={() => void applyIgnoreRule()}
        />
      ) : null}
    </div>
  );
}
