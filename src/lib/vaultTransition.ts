import type { VaultSnapshot } from "../types";

export interface VaultTab {
  path: string;
  title: string;
  /** Vault the note path is relative to. Tabs can outlive a vault switch. */
  vaultPath: string;
}

export interface HistoryEntry {
  path: string;
  vaultPath: string;
}

export interface VaultTransitionInput {
  /** Vault path the renderer had open before this snapshot. */
  previousVaultPath: string;
  snapshot: VaultSnapshot;
  tabs: VaultTab[];
  /** Active note path; it belongs to `activeVaultPath`. */
  activePath: string;
  activeVaultPath: string;
  historyTrail: HistoryEntry[];
  historyIndex: number;
  /**
   * Vault-relative directory the app itself is renaming or trashing. The
   * watcher can emit intermediate snapshots during those mutations; entries
   * below this directory must survive until the mutation settles.
   */
  protectedDirectory?: string | null;
}

export interface VaultTransitionResult {
  /** True when the host replaced the vault (for example a Finder open). */
  vaultChanged: boolean;
  tabs: VaultTab[];
  activePath: string;
  historyTrail: HistoryEntry[];
  historyIndex: number;
  /** Current-vault tabs that no longer resolve inside the snapshot. */
  discardedPaths: string[];
}

export function tabKey(vaultPath: string, relativePath: string) {
  return `${vaultPath}\u0000${relativePath}`;
}

export function tabKeyOf(tab: VaultTab) {
  return tabKey(tab.vaultPath, tab.path);
}

export function belongsToDirectory(relativePath: string, directory: string) {
  return (
    relativePath === directory || relativePath.startsWith(`${directory}/`)
  );
}

function clampHistoryIndex(index: number, length: number) {
  if (length === 0) {
    return -1;
  }
  return Math.min(Math.max(index, -1), length - 1);
}

/**
 * Reconciles the workspace with a fresh vault snapshot.
 *
 * A vault replacement no longer throws the previous tabs away: each tab
 * remembers the vault its path is relative to, so a document opened from
 * Finder in another folder stays in the strip and can be selected again later
 * (selecting it switches the vault back). Only tabs of the vault described by
 * the snapshot are garbage-collected, because only those paths can be
 * validated against the fresh index.
 *
 * Within one vault the snapshot is the source of truth: notes renamed or
 * deleted outside the app disappear from the index, and every tab pointing at
 * them has to go, not just the active one.
 */
export function planVaultTransition(
  input: VaultTransitionInput,
): VaultTransitionResult {
  const {
    previousVaultPath,
    snapshot,
    tabs,
    activePath,
    activeVaultPath,
    historyTrail,
    historyIndex,
    protectedDirectory,
  } = input;

  const vaultChanged =
    previousVaultPath !== "" && previousVaultPath !== snapshot.path;
  const available = new Set(snapshot.files.map((file) => file.path));
  const isProtected = (relativePath: string) =>
    Boolean(protectedDirectory) &&
    belongsToDirectory(relativePath, protectedDirectory as string);
  const keepCurrentVaultPath = (relativePath: string) =>
    available.has(relativePath) || isProtected(relativePath);
  const keepTab = (tab: VaultTab) =>
    tab.vaultPath !== snapshot.path || keepCurrentVaultPath(tab.path);

  const nextTabs = tabs.filter(keepTab);
  const discardedPaths = tabs
    .filter(
      (tab) => tab.vaultPath === snapshot.path && !keepCurrentVaultPath(tab.path),
    )
    .map((tab) => tab.path);

  // The active note only means something inside the vault that is open. When
  // another vault was opened, the old active note becomes an ordinary tab.
  const nextActivePath =
    !vaultChanged &&
    activeVaultPath === snapshot.path &&
    activePath &&
    keepCurrentVaultPath(activePath)
      ? activePath
      : "";

  const nextHistory = historyTrail.filter(
    (entry) =>
      entry.vaultPath !== snapshot.path ||
      keepCurrentVaultPath(entry.path),
  );
  const activeHistoryIndex = (() => {
    if (!nextActivePath) {
      return clampHistoryIndex(historyIndex, nextHistory.length);
    }
    for (
      let index = Math.min(historyIndex, nextHistory.length - 1);
      index >= 0;
      index -= 1
    ) {
      const entry = nextHistory[index];
      if (
        entry.path === nextActivePath &&
        entry.vaultPath === snapshot.path
      ) {
        return index;
      }
    }
    return nextHistory.findIndex(
      (entry) =>
        entry.path === nextActivePath &&
        entry.vaultPath === snapshot.path,
    );
  })();

  return {
    vaultChanged,
    tabs: nextTabs,
    activePath: nextActivePath,
    historyTrail: nextHistory,
    historyIndex: activeHistoryIndex,
    discardedPaths,
  };
}

/**
 * Picks the tab that should become active after closing `closedKey`. Tabs from
 * the vault that is still open win, so closing a tab does not unexpectedly
 * switch the workspace back to another vault.
 */
export function pickFallbackTab(
  tabs: VaultTab[],
  closedKey: string,
  currentVaultPath: string,
): VaultTab | null {
  const remaining = tabs.filter((tab) => tabKeyOf(tab) !== closedKey);
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    if (remaining[index].vaultPath === currentVaultPath) {
      return remaining[index];
    }
  }
  return remaining.length ? remaining[remaining.length - 1] : null;
}

/**
 * True when an open request points at a note the current vault snapshot does
 * not contain. Such paths are stale tabs or files moved/deleted outside the
 * app.
 */
export function isPathMissingFromVault(
  snapshot: VaultSnapshot | null,
  relativePath: string,
): boolean {
  if (!snapshot) {
    return false;
  }
  return !snapshot.files.some((file) => file.path === relativePath);
}
