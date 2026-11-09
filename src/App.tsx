import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Copy,
  EyeOff,
  FilePlus2,
  FilePenLine,
  FileText,
  FolderOpen,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  RotateCw,
  Trash2,
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
import {
  ContextMenu,
  type ContextMenuGroup,
} from "./components/ContextMenu";
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
import {
  SearchPanel,
  type SearchMode,
  type SearchScope,
} from "./components/panels/SearchPanel";
import { SettingsPanel } from "./components/panels/SettingsPanel";
import { TagsPanel } from "./components/panels/TagsPanel";
import {
  buildFileTree,
  parentFolder,
  remapPathAfterDirectoryRename,
} from "./lib/paths";
import { adjustEditorFontSize } from "./lib/editorZoom";
import { planExternalReload } from "./lib/externalReload";
import type { FileTreeSelectionItem } from "./lib/fileSelection";
import {
  belongsToDirectory,
  isPathMissingFromVault,
  pickFallbackTab,
  planVaultTransition,
  tabKey,
  tabKeyOf,
  type HistoryEntry,
  type VaultTab,
} from "./lib/vaultTransition";
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
  appearanceRevision: 5,
  themeMode: "light",
  accent: "#4b708b",
  background: "#ffffff",
  textColor: "#222222",
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

/** True when typing into a field must win over a global shortcut. */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return (
    target.isContentEditable ||
    Boolean(
      target.closest("input, textarea, select, [contenteditable='true']"),
    )
  );
}

function basename(relativePath: string) {
  return entryName(relativePath).replace(/\.md$/i, "");
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [booted, setBooted] = useState(false);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [tabs, setTabs] = useState<VaultTab[]>([]);
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
    selection: FileTreeSelectionItem[];
  } | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [ignoreDialog, setIgnoreDialog] = useState<{
    path: string;
    isDirectory: boolean;
    scope: GitIgnoreScope;
  } | null>(null);
  const [historyTrail, setHistoryTrail] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchMode, setSearchMode] = useState<SearchMode>("smart");
  // Incremented by Ctrl+P so the file panel can focus its filter box.
  const [fileFilterFocusRequest, setFileFilterFocusRequest] = useState(0);
  // Bumped by every applied snapshot so search results can refresh when the
  // vault index changes behind the panel.
  const [vaultRevision, setVaultRevision] = useState(0);
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
  // Renaming one note also emits a snapshot before the IPC call resolves; the
  // parent directory is protected for that moment so the tab survives.
  const noteTransitionDirectoryRef = useRef<string | null>(null);
  const closeTabRef = useRef<(tabId: string) => Promise<void>>(async () => {});
  // Tracks the newest note request so a slower, stale read cannot replace it.
  const openRequestRef = useRef(0);
  const settingsLoadedRef = useRef(false);
  const didInitializeRef = useRef(false);
  const activePathRef = useRef("");
  const activeContentRef = useRef("");
  const saveStateRef = useRef(saveState);
  // The exact version of a note the editor is showing. The watcher reports the
  // application's own saves too, so the modified time is what separates an
  // outside edit from that echo.
  const loadedNoteRef = useRef<{ path: string; modifiedAt: number } | null>(
    null,
  );
  // The renderer is not the only actor that can replace the open vault (the
  // macOS host does it when a Markdown file is opened from Finder), so the
  // workspace reconciles against snapshots instead of trusting its own state.
  // These refs let an async snapshot handler see the newest values at once.
  const vaultPathRef = useRef("");
  const vaultSnapshotRef = useRef<VaultSnapshot | null>(null);
  const snapshotEpochRef = useRef(0);
  const tabsRef = useRef<VaultTab[]>([]);
  const historyTrailRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const toastTimerRef = useRef<number | null>(null);
  // Orders concurrent vault switches requested by tab clicks / history.
  const vaultSwitchRequestRef = useRef(0);

  activePathRef.current = activePath;
  activeContentRef.current = activeContent;
  saveStateRef.current = saveState;
  tabsRef.current = tabs;
  historyTrailRef.current = historyTrail;
  historyIndexRef.current = historyIndex;

  const showToast = useCallback((message: string) => {
    // A newer message must not be cut short by the timer of an older one.
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast("");
    }, 3600);
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
    const vaultPath = vaultPathRef.current;
    const [nextOutline, nextBacklinks] = await Promise.all([
      path ? window.levilNotes.getOutline(path) : Promise.resolve([]),
      path ? window.levilNotes.getBacklinks(path) : Promise.resolve([]),
    ]);
    // Two quick opens can resolve out of order; never show note A's outline
    // and backlinks while note B (or another vault) is active.
    if (path !== activePathRef.current || vaultPath !== vaultPathRef.current) {
      return;
    }
    setOutline(nextOutline);
    setBacklinks(nextBacklinks);
  }, []);

  const refreshTags = useCallback(async () => {
    setTags(await window.levilNotes.getTags());
  }, []);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
  }, []);

  /**
   * Reconciles the workspace with a vault snapshot. Tabs remember the vault
   * their path came from, so opening a document in another folder keeps the
   * previously opened documents in the strip; only tabs of the vault described
   * by this snapshot can be validated and garbage-collected. Per-vault UI
   * (Git selection, commit draft, outline, dialogs) is reset when the vault
   * around the active note changes.
   */
  const applyVaultSnapshot = useCallback(
    (
      snapshot: VaultSnapshot,
      options?: { protectedDirectory?: string | null },
    ) => {
      const previousActivePath = activePathRef.current;
      const previousVaultPath = vaultPathRef.current;
      const previousPending = pendingSaveRef.current;
      const transition = planVaultTransition({
        previousVaultPath,
        snapshot,
        tabs: tabsRef.current,
        activePath: previousActivePath,
        activeVaultPath: previousVaultPath,
        historyTrail: historyTrailRef.current,
        historyIndex: historyIndexRef.current,
        protectedDirectory: options?.protectedDirectory ?? null,
      });

      vaultPathRef.current = snapshot.path;
      vaultSnapshotRef.current = snapshot;
      snapshotEpochRef.current += 1;
      setVaultRevision((current) => current + 1);
      tabsRef.current = transition.tabs;
      historyTrailRef.current = transition.historyTrail;
      historyIndexRef.current = transition.historyIndex;
      setVault(snapshot);
      setTabs(transition.tabs);
      setHistoryTrail(transition.historyTrail);
      setHistoryIndex(transition.historyIndex);

      const activePathChanged = transition.activePath !== previousActivePath;
      if (activePathChanged) {
        activePathRef.current = transition.activePath;
        setActivePath(transition.activePath);
        activeContentRef.current = "";
        setActiveContent("");
        setActiveView({ kind: "note" });
        loadedNoteRef.current = null;
      }

      if (transition.vaultChanged) {
        // The host flushes unsaved edits before switching vaults; anything
        // still queued belongs to the replaced vault and is unsafe to write.
        // Tabs from that vault stay in the strip and can be picked again.
        if (previousPending) {
          cancelPendingSave();
          showToast("笔记库已切换，上一笔记未保存的修改没有写入。");
        }
        setSelectedGitPaths(new Set());
        setCommitMessage("");
        setOutline([]);
        setBacklinks([]);
        setDialog(null);
        setContextMenu(null);
        setEditorMenuOpen(false);
        setSaveState("saved");
        setActiveView({ kind: "note" });
        if (transition.discardedPaths.length > 0) {
          setEditorModes((current) => {
            const next = { ...current };
            for (const discarded of transition.discardedPaths) {
              delete next[tabKey(snapshot.path, discarded)];
            }
            return next;
          });
        }
      } else {
        if (
          activePathChanged &&
          previousPending &&
          previousPending.path === previousActivePath
        ) {
          // The open note was moved or deleted outside the app. A debounced
          // write that is still queued would recreate the missing file.
          cancelPendingSave();
          setSaveState("saved");
          showToast("笔记已被移动或删除，未保存的修改没有写入。");
        }
        if (transition.discardedPaths.length > 0) {
          setEditorModes((current) => {
            const next = { ...current };
            for (const discarded of transition.discardedPaths) {
              delete next[tabKey(snapshot.path, discarded)];
            }
            return next;
          });
        }
      }

      return transition;
    },
    [cancelPendingSave, showToast],
  );

  const openNote = useCallback(
    async (
      path: string,
      recordHistory = true,
      options?: { fromHost?: boolean },
    ) => {
      if (!path) {
        return;
      }
      const fromHost = options?.fromHost === true;
      const protectedDirectory =
        directoryTransitionRef.current?.path ??
        noteTransitionDirectoryRef.current ??
        null;
      const isProtectedPath = (candidate: string) =>
        Boolean(protectedDirectory) &&
        belongsToDirectory(candidate, protectedDirectory as string);

      // VaultService.open() does not broadcast a snapshot, so a Finder-driven
      // vault switch reaches the renderer only as side data. Reconcile against
      // the live snapshot before trusting `path`; a fetch that resolves after a
      // newer snapshot was applied is ignored.
      const vaultPathBefore = vaultPathRef.current;
      const epochBefore = snapshotEpochRef.current;
      try {
        const fetched = await window.levilNotes.getVaultSnapshot();
        if (fetched && snapshotEpochRef.current === epochBefore) {
          applyVaultSnapshot(fetched, { protectedDirectory });
        }
      } catch {
        // Fall back to the workspace state that is already applied.
      }
      // Always reconcile against the newest snapshot that was actually
      // applied, so a slow fetch can never bring back an older vault.
      const snapshot = vaultSnapshotRef.current;
      const currentVaultPath = vaultPathRef.current;
      const vaultChanged =
        vaultPathBefore !== "" && currentVaultPath !== vaultPathBefore;
      if (vaultChanged) {
        // Tags and Git data describe the vault that just stopped being open.
        void refreshTags();
        void refreshGit();
        if (!fromHost && !isProtectedPath(path)) {
          // The toolbar/files panel still show the old vault's paths; resolve
          // nothing against the replacement vault.
          showToast("笔记库已切换，请从文件列表重新打开笔记。");
          return;
        }
      }

      if (
        !fromHost &&
        !isProtectedPath(path) &&
        isPathMissingFromVault(snapshot, path)
      ) {
        // The note was moved or deleted outside the app; it can never be
        // opened again, but tabs from other vaults are unaffected.
        setTabs((current) =>
          current.filter(
            (tab) =>
              !(
                tab.vaultPath === currentVaultPath &&
                tab.path === path
              ),
          ),
        );
        setEditorModes((current) => {
          const key = tabKey(currentVaultPath, path);
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
        showToast(`笔记已不存在：${path}`);
        return;
      }

      const requestId = ++openRequestRef.current;
      const pending = pendingSaveRef.current;
      if (pending) {
        try {
          await window.levilNotes.writeNote(pending.path, pending.content);
          if (pendingSaveRef.current === pending) {
            pendingSaveRef.current = null;
          }
        } catch (error) {
          // A failing save must never block opening another note: one
          // unreadable file must not freeze the whole tab strip.
          if (
            !isProtectedPath(pending.path) &&
            isPathMissingFromVault(snapshot, pending.path)
          ) {
            pendingSaveRef.current = null;
            setSaveState("saved");
            showToast("上一笔记已不在笔记库中，未保存的修改没有写入。");
          } else {
            setSaveState("error");
            showToast(
              String(error instanceof Error ? error.message : error),
            );
          }
        }
      }

      try {
        const document = await window.levilNotes.readNote(path);
        if (requestId !== openRequestRef.current) {
          return;
        }
        // Another vault switch landed while the read was in flight; this
        // result belongs to a workspace that is no longer open.
        if (vaultPathRef.current !== currentVaultPath) {
          return;
        }
        const note =
          snapshot?.files.find((file) => file.path === path) ??
          vault?.files.find((file) => file.path === path);
        const title = note?.title || basename(path);
        activePathRef.current = path;
        setActivePath(path);
        setActiveContent(document.content);
        loadedNoteRef.current = note
          ? { path, modifiedAt: note.modifiedAt }
          : null;
        setActiveView({ kind: "note" });
        // A failed pre-open flush leaves its buffer pending; pretending the
        // workspace is saved would hide that.
        if (pendingSaveRef.current === null) {
          setSaveState("saved");
        }
        setTabs((current) =>
          current.some(
            (tab) =>
              tab.vaultPath === currentVaultPath &&
              tab.path === path,
          )
            ? current
            : [...current, { path, title, vaultPath: currentVaultPath }],
        );
        await refreshVaultMetadata(path);

        if (recordHistory) {
          const clipped = historyTrailRef.current.slice(
            0,
            historyIndexRef.current + 1,
          );
          const last = clipped[clipped.length - 1];
          const nextTrail =
            last &&
            last.path === path &&
            last.vaultPath === currentVaultPath
              ? clipped
              : [...clipped, { path, vaultPath: currentVaultPath }];
          historyTrailRef.current = nextTrail;
          historyIndexRef.current = nextTrail.length - 1;
          setHistoryTrail(nextTrail);
          setHistoryIndex(nextTrail.length - 1);
        }
      } catch (error) {
        // A read can fail because the index lagged behind a file that was just
        // renamed or created on disk. Reconcile before declaring the tab dead,
        // so an index update race never turns into a wrong "missing" toast.
        if (
          !fromHost &&
          !isProtectedPath(path) &&
          vaultPathRef.current === currentVaultPath
        ) {
          const errorEpoch = snapshotEpochRef.current;
          let live = vaultSnapshotRef.current;
          try {
            const latest = await window.levilNotes.getVaultSnapshot();
            if (latest && snapshotEpochRef.current === errorEpoch) {
              applyVaultSnapshot(latest, { protectedDirectory });
              live = latest;
            }
          } catch {
            // Keep the workspace state that is already applied.
          }
          if (
            vaultPathRef.current === currentVaultPath &&
            isPathMissingFromVault(live, path)
          ) {
            setTabs((current) =>
              current.filter(
                (tab) =>
                  !(
                    tab.vaultPath === currentVaultPath &&
                    tab.path === path
                  ),
              ),
            );
            setEditorModes((current) => {
              const key = tabKey(currentVaultPath, path);
              if (!(key in current)) {
                return current;
              }
              const next = { ...current };
              delete next[key];
              return next;
            });
            showToast(`笔记已不存在：${path}`);
            return;
          }
        }
        showToast(String(error instanceof Error ? error.message : error));
      }
    },
    [
      applyVaultSnapshot,
      refreshGit,
      refreshTags,
      refreshVaultMetadata,
      showToast,
      vault,
    ],
  );

  const initializeVault = useCallback(
    async (snapshot: VaultSnapshot) => {
      // The host may have replaced the vault while this snapshot was in
      // flight, and a stale snapshot must never reset the workspace back to a
      // vault that is no longer open. Prefer the live snapshot when it is
      // available and fall back to the one that was handed over.
      let live = snapshot;
      try {
        const latest = await window.levilNotes.getVaultSnapshot();
        if (latest) {
          live = latest;
        }
      } catch {
        // Fall back to the snapshot that was handed over.
      }
      applyVaultSnapshot(live);
      await Promise.all([refreshTags(), refreshGit()]);
      if (!activePathRef.current && live.files[0]) {
        await openNote(live.files[0].path, true);
      }
    },
    [applyVaultSnapshot, openNote, refreshGit, refreshTags],
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
        // A file opened from Finder can make the host open a vault before the
        // page finishes booting. Prefer that live vault over restoring the
        // last used one, which would replace the file's vault again.
        const live = await window.levilNotes.getVaultSnapshot();
        const snapshot =
          live ?? (await window.levilNotes.restoreVault());
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
      current.map((tab) =>
        tab.vaultPath === vault.path
          ? {
              ...tab,
              title:
                vault.files.find((file) => file.path === tab.path)?.title ||
                tab.title,
            }
          : tab,
      ),
    );
  }, [vault]);

  useEffect(() => {
    const hostEvents = window.__levilNotesHostEvents;
    if (!hostEvents) {
      return undefined;
    }
    return hostEvents.onOpenFile((path) => {
      // The host may have switched the vault for this file; `fromHost` keeps a
      // legitimate open of the new vault from being rejected as a stale tab.
      void openNote(path, false, { fromHost: true });
    });
  }, [openNote]);

  const reloadActiveNote = useCallback(
    async (path: string, modifiedAt: number) => {
      // Never race an explicit open: a user click owns the buffer after this.
      if (!path || path !== activePathRef.current) {
        return;
      }
      try {
        const document = await window.levilNotes.readNote(path);
        if (path !== activePathRef.current) {
          return;
        }
        editorRef.current?.loadExternalContent(document.content);
        setActiveContent(document.content);
        loadedNoteRef.current = { path, modifiedAt };
        setSaveState("saved");
      } catch {
        // The note disappeared between the index rebuild and this read. The
        // next snapshot closes the tab, so nothing here has to undo the reload.
      }
    },
    [],
  );

  const refreshActiveNote = useCallback(async () => {
    try {
      const snapshot = await window.levilNotes.getVaultSnapshot();
      if (snapshot) {
        applyVaultSnapshot(snapshot);
      }
      await Promise.all([refreshTags(), refreshGit()]);
      const path = activePathRef.current;
      if (!path) {
        return;
      }
      if (
        pendingSaveRef.current !== null ||
        saveStateRef.current === "dirty" ||
        saveStateRef.current === "saving"
      ) {
        showToast("当前笔记有未保存的修改，未从磁盘重新载入。");
        return;
      }
      const file = snapshot?.files.find((entry) => entry.path === path);
      await reloadActiveNote(path, file?.modifiedAt ?? Date.now());
      showToast("已刷新当前笔记。");
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  }, [
    applyVaultSnapshot,
    refreshGit,
    refreshTags,
    reloadActiveNote,
    showToast,
  ]);

  useEffect(() => {
    const unsubscribe = window.levilNotes.onVaultChanged(async (snapshot) => {
      const transition = directoryTransitionRef.current;
      const protectedDirectory =
        transition?.path ?? noteTransitionDirectoryRef.current ?? null;
      const activePathInTransition = Boolean(
        transition &&
          activePathRef.current &&
          belongsToDirectory(activePathRef.current, transition.path),
      );
      applyVaultSnapshot(snapshot, { protectedDirectory });
      await refreshTags();
      await refreshGit();
      if (activePathRef.current && !activePathInTransition) {
        const decision = planExternalReload({
          reason: snapshot.reason,
          activePath: activePathRef.current,
          activeFile:
            snapshot.files.find(
              (file) => file.path === activePathRef.current,
            ) ?? null,
          loaded: loadedNoteRef.current,
          hasUnsavedEdits:
            pendingSaveRef.current !== null ||
            saveStateRef.current === "dirty" ||
            saveStateRef.current === "saving",
          isInDirectoryTransition: Boolean(activePathInTransition),
        });
        if (decision.kind === "conflict") {
          showToast("笔记在外部被修改。你的未保存编辑已保留。");
        } else if (decision.kind === "reload") {
          await reloadActiveNote(decision.path, decision.modifiedAt);
        }
        await refreshVaultMetadata(activePathRef.current);
      }
    });
    return unsubscribe;
  }, [
    applyVaultSnapshot,
    refreshGit,
    refreshTags,
    refreshVaultMetadata,
    reloadActiveNote,
    showToast,
  ]);

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
      const written = await window.levilNotes.writeNote(
        pending.path,
        pending.content,
      );
      // The user may have typed again while the write was in flight; only the
      // version that was just written is settled.
      if (pendingSaveRef.current === pending) {
        pendingSaveRef.current = null;
        if (pending.path === activePathRef.current) {
          loadedNoteRef.current = {
            path: pending.path,
            modifiedAt: written.modifiedAt,
          };
        }
        setSaveState("saved");
      }
      await refreshGit();
    } catch (error) {
      setSaveState("error");
      showToast(String(error instanceof Error ? error.message : error));
    }
  }, [refreshGit, showToast]);

  // The macOS host flushes unsaved edits before it replaces the vault for a
  // Finder double-click. This is the only moment the renderer can still write
  // to the vault that is currently open.
  useEffect(() => {
    window.__levilNotesHostFlushSave = () => flushPendingSave();
    return () => {
      delete window.__levilNotesHostFlushSave;
    };
  }, [flushPendingSave]);

  // Tabs can outlive a vault switch, so each one carries its vault path.
  // Selecting a tab from another vault first asks the native host to reopen
  // that vault; the sidecar can only serve one vault at a time.
  const switchToVault = async (vaultPath: string) => {
    if (vaultPath === vaultPathRef.current) {
      return true;
    }
    const hostEvents = window.__levilNotesHostEvents;
    if (!hostEvents?.switchVault) {
      showToast("当前环境不支持切换笔记库。");
      return false;
    }
    await flushPendingSave();
    const requestId = vaultSwitchRequestRef.current + 1;
    vaultSwitchRequestRef.current = requestId;
    try {
      const snapshot = await hostEvents.switchVault(vaultPath);
      if (requestId !== vaultSwitchRequestRef.current) {
        return false;
      }
      const latest =
        snapshot ?? (await window.levilNotes.getVaultSnapshot());
      if (requestId !== vaultSwitchRequestRef.current) {
        return false;
      }
      if (latest) {
        applyVaultSnapshot(latest);
      }
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
      return false;
    }
    if (vaultPathRef.current !== vaultPath) {
      return false;
    }
    void refreshTags();
    void refreshGit();
    return true;
  };

  const selectTab = async (tabId: string) => {
    const tab = tabsRef.current.find((entry) => tabKeyOf(entry) === tabId);
    if (!tab) {
      return;
    }
    if (tab.vaultPath !== vaultPathRef.current) {
      const switched = await switchToVault(tab.vaultPath);
      if (!switched || vaultPathRef.current !== tab.vaultPath) {
        return;
      }
    }
    await openNote(tab.path);
  };

  const handleEditorChange = useCallback(
    (path: string, markdown: string) => {
      // Bind each editor update to the note that produced it. Without this
      // guard, a delayed update from the previous editor can overwrite the
      // note the user just opened.
      if (!path || path !== activePathRef.current) {
        return;
      }
      const previousPending = pendingSaveRef.current;
      if (previousPending && previousPending.path !== path) {
        showToast("上一笔记的未保存修改仍未写入，已停止重试。");
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
    [flushPendingSave, showToast],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Modal dialogs own the keyboard while they are open: a shortcut must
      // not switch panels or save behind them.
      if (dialog || ignoreDialog) {
        return;
      }

      const command = event.ctrlKey || event.metaKey;
      // Use the physical key for panel shortcuts: on macOS Option+digit
      // reports symbols such as "¡" through event.key, so matching only the
      // character makes the advertised Alt+1…7 shortcuts dead there.
      const digitMatch = /^(?:Digit|Numpad)([1-7])$/.exec(event.code);
      if (
        event.altKey &&
        !command &&
        !event.shiftKey &&
        !event.isComposing &&
        !isEditableTarget(event.target) &&
        (digitMatch || /^[1-7]$/.test(event.key))
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
        const index = Number(digitMatch?.[1] ?? event.key) - 1;
        setActivePanel(panels[index]);
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
        return;
      }

      if (!command) {
        if (event.key === "Escape") {
          // One Escape dismisses one layer: only leave a diff/preview view when
          // no menu or popover was open to begin with.
          const hadOverlay =
            Boolean(contextMenu) ||
            editorMenuOpen ||
            Boolean(
              document.querySelector(
                ".context-menu, .git-branch-menu, .format-context-toolbar, .editor-link-popover, .editor-toolbar-menu",
              ),
            );
          setContextMenu(null);
          setEditorMenuOpen(false);
          if (!hadOverlay && activeView.kind !== "note") {
            setActiveView({ kind: "note" });
          }
        }
        return;
      }

      const editorOwnsBoldShortcut =
        event.target instanceof Element &&
        Boolean(event.target.closest(".editor-mount .ProseMirror")) &&
        // Reading mode keeps ProseMirror mounted but read-only; there Ctrl+B
        // belongs to the sidebar toggle instead of being swallowed.
        Boolean(event.target.closest(".editor-mount:not(.is-readonly)"));

      if (event.key.toLowerCase() === "b") {
        // Let Milkdown's Mod-b command format the note instead of toggling
        // the workspace sidebar while the editor owns keyboard focus.
        if (editorOwnsBoldShortcut) {
          return;
        }
        // Typing in a search/commit/rename field must not lose the caret to a
        // sidebar toggle.
        if (isEditableTarget(event.target)) {
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
        const targetInEditor =
          event.target instanceof Element &&
          Boolean(event.target.closest(".editor-mount"));
        if (isEditableTarget(event.target) && !targetInEditor) {
          return;
        }
        event.preventDefault();
        setActivePanel("files");
        setFileFilterFocusRequest((current) => current + 1);
        setSettings((current) => ({ ...current, sidebarCollapsed: false }));
      } else if (
        event.key.toLowerCase() === "w" &&
        !event.shiftKey &&
        !isEditableTarget(event.target) &&
        activePathRef.current
      ) {
        event.preventDefault();
        void closeTabRef.current(
          tabKey(vaultPathRef.current, activePathRef.current),
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeView.kind,
    contextMenu,
    dialog,
    editorMenuOpen,
    flushPendingSave,
    ignoreDialog,
  ]);

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
        // Tabs from the previous vault stay in the strip; selecting one later
        // switches the vault back through the native host.
        await initializeVault(snapshot);
      }
    } catch (error) {
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const navigateHistory = async (direction: -1 | 1) => {
    const nextIndex = historyIndexRef.current + direction;
    const entry = historyTrailRef.current[nextIndex];
    if (!entry) {
      return;
    }
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    if (entry.vaultPath !== vaultPathRef.current) {
      const switched = await switchToVault(entry.vaultPath);
      if (!switched || vaultPathRef.current !== entry.vaultPath) {
        return;
      }
    }
    await openNote(entry.path, false);
  };

  const activeFile = useMemo(
    () => vault?.files.find((file) => file.path === activePath),
    [activePath, vault],
  );
  const activeTitle = activeFile?.title || basename(activePath);
  const currentVaultPath = vault?.path ?? vaultPathRef.current;
  // Editor modes are per tab, and two vaults can both hold "README.md".
  const activeTabKey = activePath
    ? tabKey(currentVaultPath, activePath)
    : "";
  const activeEditorMode: EditorMode = activeTabKey
    ? editorModes[activeTabKey] || DEFAULT_EDITOR_MODE
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

  // Navigation history crosses vaults; rename and trash only affect notes of
  // the vault that is open right now.
  const remapHistoryPath = (vaultPath: string, from: string, to: string) => {
    const trail = historyTrailRef.current.map((entry) =>
      entry.vaultPath === vaultPath && entry.path === from
        ? { ...entry, path: to }
        : entry,
    );
    historyTrailRef.current = trail;
    setHistoryTrail(trail);
  };

  const forgetHistoryPath = (vaultPath: string, target: string) => {
    const previousTrail = historyTrailRef.current;
    const previousIndex = historyIndexRef.current;
    const removedIndex = previousTrail.findLastIndex(
      (entry) => entry.vaultPath === vaultPath && entry.path === target,
    );
    const trail = previousTrail.filter(
      (entry) =>
        !(entry.vaultPath === vaultPath && entry.path === target),
    );
    let index = previousIndex;
    if (removedIndex >= 0 && removedIndex <= previousIndex) {
      index = previousIndex - 1;
    }
    index = Math.min(Math.max(index, -1), trail.length - 1);
    historyTrailRef.current = trail;
    historyIndexRef.current = index;
    setHistoryTrail(trail);
    setHistoryIndex(index);
  };

  const confirmDialog = async () => {
    if (!dialog) {
      return;
    }
    const vaultPath = vaultPathRef.current;
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
          [tabKey(vaultPath, created.path)]: "edit",
        }));
        await openNote(created.path);
      } else if (dialog.kind === "rename") {
        // A queued save for the old path would recreate the note that is being
        // renamed, so write it first.
        await flushPendingSave();
        // renameNote emits a "renamed" snapshot before its IPC reply; protect
        // the parent folder so that snapshot cannot drop the tab/active note.
        noteTransitionDirectoryRef.current = parentFolder(dialog.path);
        const result = await window.levilNotes.renameNote(
          dialog.path,
          dialog.value,
        );
        setTabs((current) =>
          current.map((tab) =>
            tab.vaultPath === vaultPath && tab.path === dialog.path
              ? { ...tab, path: result.path, title: dialog.value }
              : tab,
          ),
        );
        setEditorModes((current) => {
          const fromKey = tabKey(vaultPath, dialog.path);
          const mode = current[fromKey];
          if (!mode) {
            return current;
          }
          const next = {
            ...current,
            [tabKey(vaultPath, result.path)]: mode,
          };
          delete next[fromKey];
          return next;
        });
        remapHistoryPath(vaultPath, dialog.path, result.path);
        if (loadedNoteRef.current?.path === dialog.path) {
          loadedNoteRef.current = {
            ...loadedNoteRef.current,
            path: result.path,
          };
        }
        if (activePath === dialog.path) {
          activePathRef.current = result.path;
          setActivePath(result.path);
        }
        const snapshot = await window.levilNotes.getVaultSnapshot();
        if (snapshot) {
          setVault(snapshot);
        }
        noteTransitionDirectoryRef.current = null;
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
          current.map((tab) =>
            tab.vaultPath === vaultPath
              ? { ...tab, path: remapPath(tab.path) }
              : tab,
          ),
        );
        setEditorModes((current) => {
          const keyPrefix = tabKey(vaultPath, "");
          const next: Record<string, EditorMode> = {};
          for (const [key, mode] of Object.entries(current)) {
            if (key.startsWith(keyPrefix)) {
              next[tabKey(vaultPath, remapPath(key.slice(keyPrefix.length)))] =
                mode;
            } else {
              next[key] = mode;
            }
          }
          return next;
        });
        setHistoryTrail((current) =>
          current.map((entry) =>
            entry.vaultPath === vaultPath
              ? { ...entry, path: remapPath(entry.path) }
              : entry,
          ),
        );
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
        await flushPendingSave();
        await window.levilNotes.trashNote(dialog.path);
        forgetHistoryPath(vaultPath, dialog.path);
        setTabs((current) =>
          current.filter(
            (tab) =>
              !(tab.vaultPath === vaultPath && tab.path === dialog.path),
          ),
        );
        setEditorModes((current) => {
          const key = tabKey(vaultPath, dialog.path);
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
        if (activePath === dialog.path) {
          // The file is gone; a debounced write would recreate it.
          cancelPendingSave();
          loadedNoteRef.current = null;
          activePathRef.current = "";
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
        const belongsToCurrentVault = (tab: { vaultPath: string; path: string }) =>
          tab.vaultPath === vaultPath &&
          belongsToDeletedFolder(tab.path);
        setTabs((current) =>
          current.filter((tab) => !belongsToCurrentVault(tab)),
        );
        setEditorModes((current) => {
          const keyPrefix = tabKey(vaultPath, "");
          return Object.fromEntries(
            Object.entries(current).filter(
              ([key]) =>
                !(
                  key.startsWith(keyPrefix) &&
                  belongsToDeletedFolder(key.slice(keyPrefix.length))
                ),
            ),
          );
        });
        const remainingHistory = historyTrailRef.current.filter(
          (entry) =>
            !(
              entry.vaultPath === vaultPath &&
              belongsToDeletedFolder(entry.path)
            ),
        );
        const nextIndex = Math.min(
          historyIndexRef.current,
          remainingHistory.length - 1,
        );
        historyTrailRef.current = remainingHistory;
        historyIndexRef.current = Math.max(nextIndex, -1);
        setHistoryTrail(remainingHistory);
        setHistoryIndex(Math.max(nextIndex, -1));
        if (belongsToDeletedFolder(activePath)) {
          activePathRef.current = "";
          setActivePath("");
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
      noteTransitionDirectoryRef.current = null;
      showToast(String(error instanceof Error ? error.message : error));
    }
  };

  const closeTab = async (tabId: string) => {
    const tab = tabsRef.current.find((entry) => tabKeyOf(entry) === tabId);
    if (!tab) {
      return;
    }
    const isActive =
      tab.vaultPath === vaultPathRef.current &&
      tab.path === activePathRef.current;
    if (isActive) {
      await flushPendingSave();
    }
    const fallback = pickFallbackTab(
      tabsRef.current,
      tabId,
      vaultPathRef.current,
    );
    const remaining = tabsRef.current.filter(
      (entry) => tabKeyOf(entry) !== tabId,
    );
    tabsRef.current = remaining;
    setTabs(remaining);
    setEditorModes((current) => {
      const key = tabKey(tab.vaultPath, tab.path);
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (!isActive) {
      return;
    }
    if (!fallback) {
      activePathRef.current = "";
      setActivePath("");
      setActiveContent("");
      setActiveView({ kind: "note" });
      return;
    }
    if (fallback.vaultPath !== vaultPathRef.current) {
      const switched = await switchToVault(fallback.vaultPath);
      if (!switched || vaultPathRef.current !== fallback.vaultPath) {
        activePathRef.current = "";
        setActivePath("");
        setActiveContent("");
        setActiveView({ kind: "note" });
        return;
      }
    }
    await openNote(fallback.path);
  };
  closeTabRef.current = closeTab;

  useEffect(() => {
    // Cmd+W (macOS menu) and Ctrl+W (Electron) close the active tab instead of
    // throwing the whole window away.
    window.__levilNotesCloseActiveTab = () => {
      const path = activePathRef.current;
      if (!path) {
        return false;
      }
      void closeTabRef.current(tabKey(vaultPathRef.current, path));
      return true;
    };
    return () => {
      delete window.__levilNotesCloseActiveTab;
    };
  }, []);

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
      [activeTabKey]: nextMode,
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
    // Clicking the active rail item again is the natural way to reclaim the
    // space the sidebar takes, matching the Ctrl+B and status-bar toggles.
    if (!settings.sidebarCollapsed && panel === activePanel) {
      setSettings((current) => ({ ...current, sidebarCollapsed: true }));
      return;
    }
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
  const multiSelectionCount = contextMenu?.selection.length || 0;
  const isMultiSelection = multiSelectionCount > 1;
  const contextSelectionPaths =
    contextMenu?.selection.map((item) => item.path) || [];

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
        tabs={tabs.map((tab) => {
          const id = tabKeyOf(tab);
          return {
            id,
            title: tab.title,
            vaultName:
              tab.vaultPath === currentVaultPath
                ? vault?.name || ""
                : basename(tab.vaultPath),
            active: id === activeTabKey,
          };
        })}
        sidebarCollapsed={settings.sidebarCollapsed}
        onSelectTab={(id) => void selectTab(id)}
        onCloseTab={(id) => void closeTab(id)}
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
                filterFocusRequest={fileFilterFocusRequest}
                onCreateNote={startNewNote}
                onOpenNote={(path) => void openNote(path)}
                onContextMenu={(path, kind, event, selection) => {
                  event.preventDefault();
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    path,
                    kind,
                    selection,
                  });
                }}
              />
            ) : activePanel === "outline" ? (
              <OutlinePanel
                notePath={activePath}
                title={activeTitle}
                entries={outline}
                onJump={(entry) => {
                  const entryIndex = outline.indexOf(entry);
                  const occurrence = outline
                    .slice(0, Math.max(entryIndex, 0))
                    .filter((candidate) => candidate.text === entry.text)
                    .length;
                  editorRef.current?.jumpToHeading(entry.text, occurrence);
                }}
              />
            ) : activePanel === "search" ? (
              <SearchPanel
                query={searchQuery}
                scope={searchScope}
                mode={searchMode}
                revision={vaultRevision}
                onQueryChange={setSearchQuery}
                onScopeChange={setSearchScope}
                onModeChange={setSearchMode}
                onOpenResult={(result: SearchResult) =>
                  void openNote(result.path)
                }
              />
            ) : activePanel === "tags" ? (
              <TagsPanel
                tags={tags}
                onSelectTag={(tag) => {
                  setSearchQuery(`#${tag}`);
                  setSearchScope("all");
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
                title="刷新笔记与 Git 状态"
                aria-label="刷新笔记与 Git 状态"
                onClick={() => void refreshActiveNote()}
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
                      void closeTab(tabKey(currentVaultPath, activePath));
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
                onBack={() => setActiveView({ kind: "note" })}
              />
            ) : activeView.kind === "working-diff" ? (
              <DiffViewer
                title={activeView.path}
                subtitle="工作区差异 · 点击左侧 Git 文件可切换"
                diff={activeView.diff}
                mode="working"
                onBack={() => setActiveView({ kind: "note" })}
              />
            ) : activeView.kind === "commit-diff" ? (
              <DiffViewer
                title={`提交 ${activeView.hash.slice(0, 8)}`}
                subtitle="历史提交差异"
                diff={activeView.diff}
                mode="commit"
                onBack={() => setActiveView({ kind: "note" })}
              />
            ) : activePath ? (
              <EditorPane
                ref={editorRef}
                key={activeTabKey || activePath}
                path={activePath}
                title={activeTitle}
                content={activeContent}
                onChange={(markdown) =>
                  handleEditorChange(activePath, markdown)
                }
                readOnly={activeEditorMode === "read"}
                onZoom={(step) =>
                  setSettings((current) => {
                    // Ctrl+wheel is a document-level zoom gesture and shares
                    // the persisted font-size setting with the settings panel.
                    const editorFontSize = adjustEditorFontSize(
                      current.editorFontSize,
                      step,
                    );
                    return editorFontSize === current.editorFontSize
                      ? current
                      : { ...current, editorFontSize };
                  })
                }
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
            {settings.sidebarCollapsed ? (
              <PanelLeftOpen size={13} />
            ) : (
              <PanelLeftClose size={13} />
            )}
          </button>
        </div>
      </footer>

      {toast ? <div className="toast">{toast}</div> : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={
            isMultiSelection
              ? "多项操作"
              : contextMenu.kind === "folder"
                ? "文件夹操作"
                : "文件操作"
          }
          caption={
            isMultiSelection
              ? `已选择 ${multiSelectionCount} 个项目`
              : undefined
          }
          groups={
            [
              {
                items: isMultiSelection
                  ? []
                  : contextMenu.kind === "file"
                    ? [
                        {
                          id: "open",
                          label: "打开",
                          Icon: FileText,
                          onSelect: () => {
                            void openNote(contextMenu.path);
                            setContextMenu(null);
                          },
                        },
                      ]
                    : [
                        {
                          id: "create-note",
                          label: "在此文件夹中新建笔记",
                          Icon: FilePlus2,
                          onSelect: () => {
                            startNewNoteInFolder(contextMenu.path);
                            setContextMenu(null);
                          },
                        },
                      ],
              },
              {
                items: isMultiSelection
                  ? [
                      {
                        id: "copy-selected-paths",
                        label: "复制所选路径",
                        Icon: Copy,
                        onSelect: () => {
                          void window.levilNotes
                            .writeClipboardText(
                              contextSelectionPaths.join("\n"),
                            )
                            .then(() =>
                              showToast(
                                `已复制 ${multiSelectionCount} 个路径`,
                              ),
                            )
                            .catch((error) =>
                              showToast(
                                String(
                                  error instanceof Error
                                    ? error.message
                                    : error,
                                ),
                              ),
                            );
                          setContextMenu(null);
                        },
                      },
                    ]
                  : [
                      {
                        id: "rename",
                        label:
                          contextMenu.kind === "folder"
                            ? "重命名文件夹"
                            : "重命名",
                        Icon: Pencil,
                        onSelect: () => {
                          setDialog(
                            contextMenu.kind === "folder"
                              ? {
                                  kind: "rename-folder",
                                  path: contextMenu.path,
                                  value: entryName(contextMenu.path),
                                }
                              : {
                                  kind: "rename",
                                  path: contextMenu.path,
                                  value: basename(contextMenu.path),
                                },
                          );
                          setContextMenu(null);
                        },
                      },
                      {
                        id: "show-in-folder",
                        label: "在资源管理器中显示",
                        Icon: FolderOpen,
                        onSelect: () => {
                          void window.levilNotes.showInFolder(
                            contextMenu.path,
                          );
                          setContextMenu(null);
                        },
                      },
                      {
                        id: "copy-path",
                        label: "复制路径",
                        Icon: Copy,
                        onSelect: () => {
                          void window.levilNotes
                            .writeClipboardText(contextMenu.path)
                            .then(() => showToast("路径已复制"))
                            .catch((error) =>
                              showToast(
                                String(
                                  error instanceof Error
                                    ? error.message
                                    : error,
                                ),
                              ),
                            );
                          setContextMenu(null);
                        },
                      },
                    ],
              },
              {
                items: isMultiSelection ? [] : [
                  ...(canDiscardContextChange
                    ? [
                        {
                          id: "discard",
                          label: "撤销未提交修改",
                          Icon: RotateCcw,
                          warning: true,
                          onSelect: () => {
                            setDialog({
                              kind: "git-discard" as const,
                              path: contextMenu.path,
                            });
                            setContextMenu(null);
                          },
                        },
                      ]
                    : []),
                  ...(gitStatus?.repository
                    ? [
                        {
                          id: "ignore",
                          label: `忽略此${
                            contextMenu.kind === "folder"
                              ? "文件夹"
                              : "文件"
                          }...`,
                          Icon: EyeOff,
                          onSelect: () => {
                            setIgnoreDialog({
                              path: contextMenu.path,
                              isDirectory:
                                contextMenu.kind === "folder",
                              scope: "project" as const,
                            });
                            setContextMenu(null);
                          },
                        },
                      ]
                    : []),
                ],
              },
              {
                items: isMultiSelection ? [] : [
                  {
                    id: "delete",
                    label:
                      contextMenu.kind === "folder"
                        ? "删除文件夹"
                        : "移到回收站",
                    Icon: Trash2,
                    danger: true,
                    onSelect: () => {
                      setDialog(
                        contextMenu.kind === "folder"
                          ? {
                              kind: "delete-folder",
                              path: contextMenu.path,
                            }
                          : {
                              kind: "delete",
                              path: contextMenu.path,
                            },
                      );
                      setContextMenu(null);
                    },
                  },
                ],
              },
            ] satisfies ContextMenuGroup[]
          }
        />
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
