import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  EyeOff,
  FileSearch,
  GitBranch,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  GitBranchInfo,
  GitChange,
  GitChangeKind,
  GitCommit,
  GitIgnoreScope,
  GitIgnoreState,
  GitStatus,
} from "../../types";

const changeLegend: Array<{
  kind: GitChangeKind;
  code: string;
  label: string;
}> = [
  { kind: "modified", code: "M", label: "修改" },
  { kind: "added", code: "A", label: "新增" },
  { kind: "deleted", code: "D", label: "删除" },
  { kind: "renamed", code: "R", label: "重命名" },
  { kind: "conflict", code: "U", label: "冲突" },
  { kind: "untracked", code: "?", label: "未跟踪" },
];

type GitTab = "changes" | "history" | "ignore";

function splitGitPath(changePath: string) {
  const separator = changePath.lastIndexOf("/");
  return separator === -1
    ? { name: changePath, directory: "笔记库根目录" }
    : {
        name: changePath.slice(separator + 1),
        directory: changePath.slice(0, separator),
      };
}

function changeFlags(change: GitChange) {
  if (change.conflict) {
    return ["需解决冲突"];
  }

  const flags: string[] = [];
  if (change.staged) {
    flags.push("已暂存");
  }
  if (change.hasUnstaged) {
    flags.push("未暂存");
  }
  return flags;
}

function ignoreScopeLabel(scope: GitIgnoreScope) {
  return scope === "project" ? "随仓库共享" : "仅本机";
}

interface GitPanelProps {
  status: GitStatus | null;
  activeNotePath: string;
  busy: boolean;
  selectedPaths: Set<string>;
  commitMessage: string;
  ignoreRevision: number;
  onSelectPaths(next: Set<string>): void;
  onCommitMessageChange(value: string): void;
  onRefresh(): void;
  onOpenDiff(path: string): void;
  onOpenFile(path: string): void;
  onDiscard(path: string): void;
  onToggleStage(changePath: string, staged: boolean): void;
  onPreviewCommit(): void;
  onCommit(pushAfter: boolean): void;
  onFetch(): void;
  onPull(): void;
  onPush(): void;
  onCreateBranch(name: string): void;
  onCheckoutBranch(name: string): void;
  onRemoveIgnore(scope: GitIgnoreScope, line: number): void;
  onCommitIgnoredRemovals(): void;
  onShowCommit(hash: string): void;
}

export function GitPanel({
  status,
  activeNotePath,
  busy,
  selectedPaths,
  commitMessage,
  ignoreRevision,
  onSelectPaths,
  onCommitMessageChange,
  onRefresh,
  onOpenDiff,
  onOpenFile,
  onDiscard,
  onToggleStage,
  onPreviewCommit,
  onCommit,
  onFetch,
  onPull,
  onPush,
  onCreateBranch,
  onCheckoutBranch,
  onRemoveIgnore,
  onCommitIgnoredRemovals,
  onShowCommit,
}: GitPanelProps) {
  const [tab, setTab] = useState<GitTab>("changes");
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [ignoreState, setIgnoreState] = useState<GitIgnoreState | null>(null);
  const [loadingIgnore, setLoadingIgnore] = useState(false);

  useEffect(() => {
    if (tab !== "history") {
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    window.levilNotes
      .gitLog(activeNotePath || undefined)
      .then((commits) => {
        if (!cancelled) {
          setHistory(commits);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistory([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeNotePath, status?.branch, status?.changes.length, tab]);

  useEffect(() => {
    if (!branchMenuOpen) {
      return;
    }
    let cancelled = false;
    setLoadingBranches(true);
    window.levilNotes
      .gitBranches()
      .then((nextBranches) => {
        if (!cancelled) {
          setBranches(nextBranches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBranches(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branchMenuOpen, status?.branch]);

  useEffect(() => {
    if (tab !== "ignore") {
      return;
    }
    let cancelled = false;
    setLoadingIgnore(true);
    window.levilNotes
      .gitIgnoreState()
      .then((state) => {
        if (!cancelled) {
          setIgnoreState(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIgnoreState(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingIgnore(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ignoreRevision, status?.ignoredCount, tab]);

  const toggleSelected = (path: string) => {
    const change = status?.changes.find((item) => item.path === path);
    if (change?.conflict) {
      return;
    }
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    onSelectPaths(next);
  };

  const selectAll = () => {
    const changes = (status?.changes || []).filter(
      (change) => !change.conflict,
    );
    if (selectedPaths.size > 0 && selectedPaths.size === changes.length) {
      onSelectPaths(new Set());
    } else {
      onSelectPaths(new Set(changes.map((change) => change.path)));
    }
  };

  const confirmCreateBranch = () => {
    if (!branchName.trim()) {
      return;
    }
    onCreateBranch(branchName.trim());
    setBranchName("");
    setCreatingBranch(false);
    setBranchMenuOpen(false);
  };

  const legendCounts = (status?.changes || []).reduce(
    (counts, change) => {
      counts[change.kind] = (counts[change.kind] || 0) + 1;
      return counts;
    },
    {} as Partial<Record<GitChangeKind, number>>,
  );

  if (!status?.repository) {
    return (
      <div className="side-panel-content">
        <div className="panel-title-row">
          <div>
            <span className="panel-kicker">版本管理</span>
            <strong>Git</strong>
          </div>
        </div>
        <div className="panel-empty tall">
          <GitBranch size={24} />
          <span>当前笔记库还不是 Git 仓库</span>
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel-content git-panel">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">版本管理</span>
          <strong>Git</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新 Git 状态"
          title="刷新 Git 状态"
          onClick={onRefresh}
          disabled={busy}
        >
          <RefreshCw size={14} className={busy ? "spinning" : ""} />
        </button>
      </div>

      <div className="git-branch-card">
        <div className="git-branch-line">
          <GitBranch size={14} />
          <button
            type="button"
            className="git-branch-trigger"
            onClick={() => {
              setBranchMenuOpen((current) => !current);
              setCreatingBranch(false);
            }}
            disabled={busy}
            title="切换或新建分支"
          >
            <strong>{status.branch}</strong>
            <ChevronDown size={12} />
          </button>
          <span className="git-sync-counts">
            {status.ahead > 0 ? `↑${status.ahead}` : ""}
            {status.behind > 0 ? `↓${status.behind}` : ""}
          </span>
        </div>
        <span>{status.remote || "未配置主远端"}</span>

        {branchMenuOpen ? (
          <div className="git-branch-menu">
            <div className="git-branch-menu-title">
              <span>切换本地分支</span>
              <button
                type="button"
                className="icon-button"
                title="关闭分支列表"
                aria-label="关闭分支列表"
                onClick={() => setBranchMenuOpen(false)}
              >
                <X size={12} />
              </button>
            </div>
            <div className="git-branch-list">
              {loadingBranches ? (
                <span className="git-branch-loading">正在读取分支...</span>
              ) : branches.length ? (
                branches.map((branch) => (
                  <button
                    type="button"
                    key={branch.name}
                    className={branch.current ? "active" : ""}
                    disabled={busy || branch.current}
                    onClick={() => {
                      setBranchMenuOpen(false);
                      onCheckoutBranch(branch.name);
                    }}
                  >
                    <span>{branch.name}</span>
                    {branch.current ? <Check size={12} /> : null}
                  </button>
                ))
              ) : (
                <span className="git-branch-loading">暂无本地分支</span>
              )}
            </div>

            {creatingBranch ? (
              <div className="git-branch-create">
                <input
                  autoFocus
                  value={branchName}
                  placeholder="例如 notes/reading"
                  onChange={(event) => setBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      confirmCreateBranch();
                    }
                    if (event.key === "Escape") {
                      setCreatingBranch(false);
                    }
                  }}
                />
                <button
                  type="button"
                  title="创建分支"
                  aria-label="创建分支"
                  disabled={busy || !branchName.trim()}
                  onClick={confirmCreateBranch}
                >
                  <Check size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="git-branch-add"
                onClick={() => setCreatingBranch(true)}
              >
                <Plus size={12} />
                新建分支
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="git-actions">
        <button type="button" onClick={onFetch} disabled={busy}>
          获取
        </button>
        <button type="button" onClick={onPull} disabled={busy}>
          <ArrowDown size={12} /> 拉取
        </button>
        <button type="button" onClick={onPush} disabled={busy}>
          <ArrowUp size={12} /> 推送
        </button>
      </div>

      <div className="segmented git-tabs">
        <button
          type="button"
          className={tab === "changes" ? "active" : ""}
          onClick={() => setTab("changes")}
        >
          变更
          <span>{status.changes.length}</span>
        </button>
        <button
          type="button"
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          历史
        </button>
        <button
          type="button"
          className={tab === "ignore" ? "active" : ""}
          onClick={() => setTab("ignore")}
        >
          忽略
          <span>{status.ignoredCount}</span>
        </button>
      </div>

      {tab === "changes" ? (
        <>
          {status.changes.length ? (
            <div className="git-change-legend" aria-label="变更类型图例">
              {changeLegend.map((item) =>
                legendCounts[item.kind] ? (
                  <span
                    key={item.kind}
                    className={`git-legend-item git-kind-${item.kind}`}
                    title={`${item.label} ${legendCounts[item.kind]} 个`}
                  >
                    <span className="git-legend-code">{item.code}</span>
                    {item.label}
                    <strong>{legendCounts[item.kind]}</strong>
                  </span>
                ) : null,
              )}
            </div>
          ) : null}
          <div className="git-list-head">
            <button type="button" className="text-button" onClick={selectAll}>
              {selectedPaths.size > 0 &&
              selectedPaths.size ===
                status.changes.filter((change) => !change.conflict).length
                ? "取消全选"
                : "全选可提交变更"}
            </button>
            <span>{selectedPaths.size} 个待处理</span>
          </div>
          <div className="git-change-list">
            {status.changes.length ? (
              status.changes.map((change) => {
                const file = splitGitPath(change.path);
                const flags = changeFlags(change);
                const canDiscard =
                  !change.conflict &&
                  ["modified", "deleted"].includes(change.kind);
                return (
                  <div
                    key={change.path}
                    className={`git-change-row git-kind-${change.kind} ${
                      change.conflict ? "conflict" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={`git-check ${
                        selectedPaths.has(change.path) ? "checked" : ""
                      }`}
                      title={
                        change.conflict
                          ? "请先解决冲突"
                          : selectedPaths.has(change.path)
                            ? "取消选择文件"
                            : "选择文件"
                      }
                      aria-label={
                        selectedPaths.has(change.path)
                          ? "取消选择文件"
                          : "选择文件"
                      }
                      disabled={change.conflict}
                      onClick={() => toggleSelected(change.path)}
                    >
                      {selectedPaths.has(change.path) ? (
                        <Check size={11} />
                      ) : null}
                    </button>
                    <span className="git-change-kind" aria-hidden="true">
                      {change.code}
                    </span>
                    <button
                      type="button"
                      className="git-file-main"
                      title={
                        change.conflict
                          ? `${change.path}，打开文件处理冲突`
                          : change.path
                      }
                      onClick={() =>
                        change.conflict
                          ? onOpenFile(change.path)
                          : onOpenDiff(change.path)
                      }
                    >
                      <span className="git-file-path">{file.name}</span>
                      <span className="git-file-directory">
                        {file.directory}
                      </span>
                      <span className="git-file-meta">
                        <span className="git-state-label">
                          {change.conflict ? "打开处理" : change.label}
                        </span>
                        {flags.map((flag) => (
                          <span key={flag}>{flag}</span>
                        ))}
                      </span>
                    </button>
                    <div className="git-row-actions">
                      {canDiscard ? (
                        <button
                          type="button"
                          className="git-row-action"
                          disabled={busy}
                          title="撤销此文件的未提交修改"
                          aria-label="撤销此文件的未提交修改"
                          onClick={() => onDiscard(change.path)}
                        >
                          <RotateCcw size={12} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="git-stage-button"
                        disabled={change.conflict}
                        title={
                          change.conflict
                            ? "冲突文件需先解决"
                            : change.staged
                              ? "取消暂存"
                              : "暂存文件"
                        }
                        onClick={() =>
                          onToggleStage(change.path, change.staged)
                        }
                      >
                        {change.conflict ? "!" : change.staged ? "−" : "+"}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="panel-empty">
                <Check size={22} />
                <span>工作区是干净的</span>
              </div>
            )}
          </div>
          <div className="commit-box">
            <textarea
              value={commitMessage}
              onChange={(event) => onCommitMessageChange(event.target.value)}
              placeholder="提交说明"
              rows={3}
            />
            <button
              type="button"
              className="commit-preview-trigger"
              disabled={busy || !selectedPaths.size}
              onClick={onPreviewCommit}
            >
              <FileSearch size={13} />
              <span>预览提交内容</span>
              <small>{selectedPaths.size} 个文件</small>
            </button>
            <div className="commit-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={busy || !selectedPaths.size}
                onClick={() => onCommit(false)}
              >
                提交
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={busy || !selectedPaths.size}
                onClick={() => onCommit(true)}
              >
                提交并推送
              </button>
            </div>
          </div>
        </>
      ) : tab === "history" ? (
        <>
          <div className="git-list-head">
            <span>{activeNotePath ? "当前笔记历史" : "仓库历史"}</span>
            <span>{history.length} 条</span>
          </div>
          <div className="git-history-list">
            {loadingHistory ? (
              <div className="panel-empty">正在读取提交历史...</div>
            ) : history.length ? (
              history.map((commit) => (
                <button
                  type="button"
                  key={commit.hash}
                  className={`git-history-row ${
                    activeNotePath ? "" : "global"
                  }`}
                  onClick={() => onShowCommit(commit.hash)}
                >
                  <span className="commit-subject">{commit.subject}</span>
                  <span className="commit-meta">
                    <Clock3 size={11} />
                    {commit.shortHash} · {commit.author} ·{" "}
                    {new Date(commit.date).toLocaleDateString("zh-CN")}
                  </span>
                </button>
              ))
            ) : (
              <div className="panel-empty">
                <GitBranch size={22} />
                <span>当前笔记还没有提交记录</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="git-list-head">
            <span>忽略规则</span>
            <span>{ignoreState?.ignoredCount ?? status.ignoredCount} 个路径</span>
          </div>
          {status.ignoredTrackedChanges.length ? (
            <div className="git-ignore-pending">
              <AlertTriangle size={15} />
              <span>
                <strong>
                  {status.ignoredTrackedChanges.length} 个已跟踪路径等待停止跟踪
                </strong>
                <small>提交后从仓库移除，本地文件保留。</small>
              </span>
              <button
                type="button"
                className="secondary-action"
                disabled={
                  busy ||
                  status.changes.some((change) => change.staged)
                }
                title={
                  status.changes.some((change) => change.staged)
                    ? "请先提交或取消暂存其他已暂存文件"
                    : "提交停止跟踪记录"
                }
                onClick={onCommitIgnoredRemovals}
              >
                提交移除
              </button>
            </div>
          ) : null}
          <div className="git-ignore-list">
            {loadingIgnore ? (
              <div className="panel-empty">正在读取忽略规则...</div>
            ) : ignoreState?.rules.length ? (
              ignoreState.rules.map((rule) => (
                <div
                  key={`${rule.scope}:${rule.line}:${rule.pattern}`}
                  className="git-ignore-rule"
                >
                  <div className="git-ignore-rule-main">
                    <code>{rule.pattern}</code>
                    <span>
                      {ignoreScopeLabel(rule.scope)} · {rule.source}:
                      {rule.line}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="git-row-action"
                    disabled={busy}
                    title="移除忽略规则"
                    aria-label={`移除忽略规则 ${rule.pattern}`}
                    onClick={() => onRemoveIgnore(rule.scope, rule.line)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            ) : (
              <div className="panel-empty">
                <EyeOff size={22} />
                <span>还没有忽略规则</span>
              </div>
            )}
          </div>
          <p className="git-ignore-hint">
            可在文件或目录的右键菜单中选择“忽略”。移除规则不会自动重新跟踪文件。
          </p>
        </>
      )}
    </div>
  );
}
