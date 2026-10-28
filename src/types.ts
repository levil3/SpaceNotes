export type ThemeMode = "light" | "dark" | "system";
export type SidebarPanel =
  | "files"
  | "outline"
  | "search"
  | "tags"
  | "backlinks"
  | "git"
  | "settings";

export interface AppSettings {
  appearanceRevision: number;
  themeMode: ThemeMode;
  accent: string;
  background: string;
  textColor: string;
  editorFontSize: number;
  editorLineHeight: number;
  contentWidth: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  showHiddenFiles: boolean;
  recentVault: string;
}

export interface NoteFile {
  path: string;
  title: string;
  modifiedAt: number;
  size: number;
  tags: string[];
}

export interface VaultSnapshot {
  path: string;
  name: string;
  reason: string;
  files: NoteFile[];
  directories: string[];
}

export interface NoteDocument {
  path: string;
  content: string;
}

export interface OutlineEntry {
  level: number;
  text: string;
  line: number;
}

export interface SearchResult {
  path: string;
  title: string;
  matchKind: "title" | "content";
  snippet: string;
  modifiedAt: number;
}

export interface BacklinkResult {
  path: string;
  title: string;
  snippet: string;
}

export interface TagResult {
  tag: string;
  count: number;
}

export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflict"
  | "untracked"
  | "ignored";

export interface GitChange {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  code: string;
  kind: GitChangeKind;
  staged: boolean;
  hasUnstaged: boolean;
  untracked: boolean;
  conflict: boolean;
  label: string;
  ignoredByRule?: boolean;
  ignoredRule?: {
    source: string;
    line: number;
    pattern: string;
  };
}

export interface GitStatus {
  repository: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  ignoredTrackedChanges: GitChange[];
  ignoredTrackedCount: number;
  ignoredCount: number;
  remote: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export type GitIgnoreScope = "project" | "local";

export interface GitIgnoreRule {
  scope: GitIgnoreScope;
  source: string;
  line: number;
  pattern: string;
}

export interface GitIgnoreState {
  rules: GitIgnoreRule[];
  ignoredCount: number;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream: string;
}

export interface GitBranchResult {
  output: string;
  status: GitStatus;
  branches: GitBranchInfo[];
}

export interface VaultChangedPayload extends VaultSnapshot {
  reason: string;
}

export interface LevilNotesApi {
  chooseVault(): Promise<VaultSnapshot | null>;
  restoreVault(): Promise<VaultSnapshot | null>;
  getVaultSnapshot(): Promise<VaultSnapshot | null>;
  readNote(path: string): Promise<NoteDocument>;
  writeNote(path: string, content: string): Promise<{ modifiedAt: number }>;
  createNote(
    parentPath: string,
    title: string,
  ): Promise<{ path: string; content: string }>;
  trashNote(path: string): Promise<void>;
  renameNote(path: string, title: string): Promise<{ path: string }>;
  renameDirectory(path: string, name: string): Promise<{ path: string }>;
  trashDirectory(path: string): Promise<void>;
  getNoteHistory(path: string): Promise<GitCommit[]>;

  search(
    query: string,
    scope: "all" | "title" | "content",
    mode: "smart" | "exact",
  ): Promise<SearchResult[]>;
  getOutline(path: string): Promise<OutlineEntry[]>;
  getBacklinks(path: string): Promise<BacklinkResult[]>;
  getTags(): Promise<TagResult[]>;

  gitStatus(): Promise<GitStatus>;
  gitDiff(path: string): Promise<string>;
  gitStage(paths: string[], staged: boolean): Promise<GitStatus>;
  gitCommit(
    message: string,
    selectedPaths: string[],
  ): Promise<{ output: string; status: GitStatus }>;
  gitPreviewCommit(selectedPaths: string[]): Promise<string>;
  gitFetch(): Promise<{ output: string; status: GitStatus }>;
  gitPull(): Promise<{ output: string; status: GitStatus }>;
  gitPush(): Promise<{ output: string; status: GitStatus }>;
  gitDiscard(paths: string[]): Promise<GitStatus>;
  gitBranches(): Promise<GitBranchInfo[]>;
  gitCreateBranch(name: string): Promise<GitBranchResult>;
  gitCheckoutBranch(name: string): Promise<GitBranchResult>;
  gitIgnoreState(): Promise<GitIgnoreState>;
  gitAddIgnore(options: {
    path: string;
    isDirectory: boolean;
    scope: GitIgnoreScope;
  }): Promise<{
    output: string;
    status: GitStatus;
    state: GitIgnoreState;
  }>;
  gitRemoveIgnore(
    scope: GitIgnoreScope,
    line: number,
  ): Promise<{
    output: string;
    status: GitStatus;
    state: GitIgnoreState;
  }>;
  gitLog(path?: string): Promise<GitCommit[]>;
  gitShow(hash: string): Promise<string>;

  getSettings(): Promise<AppSettings>;
  saveSettings(
    updates: Partial<AppSettings>,
  ): Promise<AppSettings>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  showInFolder(path: string): Promise<void>;

  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onVaultChanged(
    callback: (snapshot: VaultChangedPayload) => void,
  ): () => void;
}

declare global {
  interface Window {
    levilNotes: LevilNotesApi;
  }
}
