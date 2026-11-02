/**
 * Decides what the open note should do when the vault index reports a change.
 *
 * Only `external-change` snapshots come from the file watcher, and the watcher
 * also reports the writes this application made itself. Comparing the modified
 * time of the open note against the version the editor actually loaded tells
 * those two apart: an unchanged stamp means there is nothing to reload.
 *
 * Unsaved local edits are never discarded silently, because the editor and the
 * external writer would otherwise overwrite each other.
 */
export type ExternalReloadDecision =
  | { kind: "reload"; path: string; modifiedAt: number }
  | { kind: "conflict"; path: string }
  | { kind: "ignore" };

export interface LoadedNoteStamp {
  path: string;
  modifiedAt: number;
}

export interface ExternalReloadInput {
  reason: string | null | undefined;
  activePath: string;
  /** The open note as the new snapshot sees it, or null when it is gone. */
  activeFile: { modifiedAt: number } | null;
  /** The version currently shown in the editor. */
  loaded: LoadedNoteStamp | null;
  hasUnsavedEdits: boolean;
  isInDirectoryTransition: boolean;
}

export function planExternalReload(
  input: ExternalReloadInput,
): ExternalReloadDecision {
  if (input.reason !== "external-change") {
    return { kind: "ignore" };
  }
  if (!input.activePath || input.isInDirectoryTransition) {
    return { kind: "ignore" };
  }
  if (!input.activeFile) {
    // Deletion is the tab-closing branch's job, not a reload.
    return { kind: "ignore" };
  }
  if (
    input.loaded &&
    input.loaded.path === input.activePath &&
    input.loaded.modifiedAt === input.activeFile.modifiedAt
  ) {
    return { kind: "ignore" };
  }
  if (input.hasUnsavedEdits) {
    return { kind: "conflict", path: input.activePath };
  }
  return {
    kind: "reload",
    path: input.activePath,
    modifiedAt: input.activeFile.modifiedAt,
  };
}
