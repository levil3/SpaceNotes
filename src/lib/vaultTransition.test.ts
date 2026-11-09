import { describe, expect, it } from "vitest";
import {
  isPathMissingFromVault,
  pickFallbackTab,
  planVaultTransition,
  tabKey,
  tabKeyOf,
  type HistoryEntry,
  type VaultTab,
  type VaultTransitionInput,
} from "./vaultTransition";
import type { VaultSnapshot } from "../types";

function snapshot(path: string, files: string[]): VaultSnapshot {
  return {
    path,
    name: path.split("/").pop() || path,
    reason: "opened",
    files: files.map((file) => ({
      path: file,
      title: file.replace(/\.md$/i, ""),
      modifiedAt: 1,
      size: 1,
      tags: [],
    })),
    directories: [],
  };
}

const VAULT_A = "/Users/yuzhou/vault-a";
const VAULT_B = "/Users/yuzhou/vault-b";

const tab = (vaultPath: string, path: string): VaultTab => ({
  vaultPath,
  path,
  title: path.replace(/\.md$/i, ""),
});

const history = (vaultPath: string, path: string): HistoryEntry => ({
  vaultPath,
  path,
});

const base: VaultTransitionInput = {
  previousVaultPath: VAULT_A,
  snapshot: snapshot(VAULT_A, ["专利交底书.md", "agent-design-spec.md"]),
  tabs: [
    tab(VAULT_A, "专利交底书.md"),
    tab(VAULT_A, "agent-design-spec.md"),
  ],
  activePath: "agent-design-spec.md",
  activeVaultPath: VAULT_A,
  historyTrail: [
    history(VAULT_A, "专利交底书.md"),
    history(VAULT_A, "agent-design-spec.md"),
  ],
  historyIndex: 1,
};

describe("planVaultTransition", () => {
  it("keeps the workspace when the snapshot describes the same vault", () => {
    const result = planVaultTransition(base);

    expect(result.vaultChanged).toBe(false);
    expect(result.tabs).toEqual(base.tabs);
    expect(result.activePath).toBe("agent-design-spec.md");
    expect(result.discardedPaths).toEqual([]);
  });

  it("treats the first snapshot as a baseline instead of a vault switch", () => {
    const result = planVaultTransition({
      ...base,
      previousVaultPath: "",
      tabs: [],
      activePath: "",
      activeVaultPath: "",
      historyTrail: [],
      historyIndex: -1,
    });

    expect(result.vaultChanged).toBe(false);
    expect(result.tabs).toEqual([]);
  });

  it("drops every tab whose note vanished from the index, not just the active one", () => {
    const result = planVaultTransition({
      ...base,
      snapshot: snapshot(VAULT_A, ["agent-design-spec.md"]),
    });

    expect(result.tabs).toEqual([tab(VAULT_A, "agent-design-spec.md")]);
    expect(result.discardedPaths).toEqual(["专利交底书.md"]);
  });

  it("clears the active note when it vanished from the current vault", () => {
    const result = planVaultTransition({
      ...base,
      activePath: "专利交底书.md",
      snapshot: snapshot(VAULT_A, ["agent-design-spec.md"]),
    });

    expect(result.activePath).toBe("");
    expect(result.historyTrail).toEqual([
      history(VAULT_A, "agent-design-spec.md"),
    ]);
    expect(result.historyIndex).toBe(0);
  });

  it("keeps tabs from other vaults and only clears the old active note", () => {
    // Finder opened a document in vault B: the tabs from vault A must stay in
    // the strip instead of being silently closed.
    const result = planVaultTransition({
      ...base,
      snapshot: snapshot(VAULT_B, ["外部笔记.md"]),
    });

    expect(result.vaultChanged).toBe(true);
    expect(result.tabs).toEqual(base.tabs);
    expect(result.tabs.map((entry) => entry.vaultPath)).toEqual([
      VAULT_A,
      VAULT_A,
    ]);
    expect(result.activePath).toBe("");
    expect(result.discardedPaths).toEqual([]);
    // History survives so Back can return to the previous vault's note.
    expect(result.historyTrail).toEqual(base.historyTrail);
  });

  it("still prunes tabs of the newly opened vault that no longer exist", () => {
    const result = planVaultTransition({
      ...base,
      previousVaultPath: VAULT_A,
      snapshot: snapshot(VAULT_B, ["仍存在.md"]),
      tabs: [
        tab(VAULT_A, "专利交底书.md"),
        tab(VAULT_B, "已删除.md"),
        tab(VAULT_B, "仍存在.md"),
      ],
      activePath: "",
      activeVaultPath: VAULT_A,
    });

    expect(result.tabs).toEqual([
      tab(VAULT_A, "专利交底书.md"),
      tab(VAULT_B, "仍存在.md"),
    ]);
    expect(result.discardedPaths).toEqual(["已删除.md"]);
  });

  it("ignores rename protection when the vault itself was replaced", () => {
    const result = planVaultTransition({
      ...base,
      previousVaultPath: VAULT_A,
      tabs: [tab(VAULT_A, "临时/草稿.md")],
      activePath: "",
      activeVaultPath: VAULT_A,
      historyTrail: [],
      historyIndex: -1,
      snapshot: snapshot(VAULT_B, []),
      protectedDirectory: "临时",
    });

    expect(result.vaultChanged).toBe(true);
    // Protection only applies to tabs of the vault being reconciled.
    expect(result.tabs).toEqual([tab(VAULT_A, "临时/草稿.md")]);
  });

  it("keeps entries under a directory the app is renaming", () => {
    const result = planVaultTransition({
      ...base,
      tabs: [tab(VAULT_A, "临时/草稿.md"), tab(VAULT_A, "gone.md")],
      activePath: "临时/草稿.md",
      historyTrail: [history(VAULT_A, "临时/草稿.md")],
      historyIndex: 0,
      snapshot: snapshot(VAULT_A, []),
      protectedDirectory: "临时",
    });

    expect(result.tabs).toEqual([tab(VAULT_A, "临时/草稿.md")]);
    expect(result.activePath).toBe("临时/草稿.md");
    expect(result.discardedPaths).toEqual(["gone.md"]);
    expect(result.historyTrail).toEqual([history(VAULT_A, "临时/草稿.md")]);
  });

  it("keeps the history cursor on the same occurrence of a repeatedly visited note", () => {
    const result = planVaultTransition({
      ...base,
      activePath: "a.md",
      historyTrail: [
        history(VAULT_A, "a.md"),
        history(VAULT_A, "b.md"),
        history(VAULT_A, "a.md"),
      ],
      historyIndex: 2,
      snapshot: snapshot(VAULT_A, ["a.md", "b.md"]),
    });

    expect(result.historyTrail).toHaveLength(3);
    expect(result.historyIndex).toBe(2);
  });

  it("clears an active note whose vault is no longer the open one", () => {
    // Defensive case: the renderer can briefly hold an active note from a
    // vault that is not the one described by the snapshot.
    const result = planVaultTransition({
      ...base,
      previousVaultPath: VAULT_A,
      snapshot: snapshot(VAULT_A, ["专利交底书.md"]),
      activePath: "外部笔记.md",
      activeVaultPath: VAULT_B,
    });

    expect(result.vaultChanged).toBe(false);
    expect(result.activePath).toBe("");
    // Only the note that still exists in this vault keeps its tab.
    expect(result.tabs).toEqual([tab(VAULT_A, "专利交底书.md")]);
  });

  it("keeps history entries of other vaults and clamps the cursor", () => {
    const result = planVaultTransition({
      ...base,
      previousVaultPath: VAULT_A,
      snapshot: snapshot(VAULT_A, ["专利交底书.md"]),
      activePath: "",
      historyTrail: [
        history(VAULT_B, "外部笔记.md"),
        history(VAULT_A, "被删除.md"),
        history(VAULT_A, "专利交底书.md"),
      ],
      historyIndex: 2,
    });

    expect(result.historyTrail).toEqual([
      history(VAULT_B, "外部笔记.md"),
      history(VAULT_A, "专利交底书.md"),
    ]);
    expect(result.historyIndex).toBe(1);
  });
});

describe("tabKey", () => {
  it("distinguishes the same relative path in different vaults", () => {
    const first = tabKey(VAULT_A, "README.md");
    const second = tabKey(VAULT_B, "README.md");

    expect(first).not.toBe(second);
    expect(first).toBe(tabKeyOf(tab(VAULT_A, "README.md")));
  });
});

describe("pickFallbackTab", () => {
  it("prefers a tab from the vault that is still open", () => {
    const tabs = [
      tab(VAULT_A, "a.md"),
      tab(VAULT_B, "b.md"),
      tab(VAULT_A, "c.md"),
    ];

    expect(pickFallbackTab(tabs, tabKey(VAULT_A, "c.md"), VAULT_A)).toEqual(
      tab(VAULT_A, "a.md"),
    );
  });

  it("falls back to another vault when no current-vault tab remains", () => {
    const tabs = [tab(VAULT_A, "a.md"), tab(VAULT_B, "b.md")];

    expect(pickFallbackTab(tabs, tabKey(VAULT_A, "a.md"), VAULT_A)).toEqual(
      tab(VAULT_B, "b.md"),
    );
  });

  it("falls back to the last visible tab when the closed key is unknown", () => {
    const tabs = [
      tab(VAULT_A, "a.md"),
      tab(VAULT_A, "b.md"),
      tab(VAULT_B, "c.md"),
    ];

    expect(pickFallbackTab(tabs, "missing-key", VAULT_A)).toEqual(
      tab(VAULT_A, "b.md"),
    );
  });

  it("returns null when the last tab was closed", () => {
    expect(
      pickFallbackTab([tab(VAULT_A, "a.md")], tabKey(VAULT_A, "a.md"), VAULT_A),
    ).toBeNull();
  });
});

describe("isPathMissingFromVault", () => {
  it("flags stale paths so an open request can be discarded", () => {
    expect(
      isPathMissingFromVault(snapshot(VAULT_B, []), "专利交底书.md"),
    ).toBe(true);
    expect(
      isPathMissingFromVault(
        snapshot(VAULT_B, ["专利交底书.md"]),
        "专利交底书.md",
      ),
    ).toBe(false);
  });

  it("does not flag anything when no snapshot is available", () => {
    expect(isPathMissingFromVault(null, "专利交底书.md")).toBe(false);
  });
});
