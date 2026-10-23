import { AlertTriangle, FileText, Folder, GitBranch } from "lucide-react";
import type { GitIgnoreScope } from "../types";

interface GitIgnoreDialogProps {
  path: string;
  isDirectory: boolean;
  scope: GitIgnoreScope;
  busy: boolean;
  onScopeChange(scope: GitIgnoreScope): void;
  onCancel(): void;
  onConfirm(): void;
}

function basename(path: string) {
  return path.split("/").pop() || path;
}

function formatIgnorePattern(path: string, isDirectory: boolean) {
  const escaped = path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((component) => component.replace(/([\\*?[\]])/g, "\\$1"))
    .join("/");
  return `/${escaped}${isDirectory ? "/" : ""}`;
}

export function GitIgnoreDialog({
  path,
  isDirectory,
  scope,
  busy,
  onScopeChange,
  onCancel,
  onConfirm,
}: GitIgnoreDialogProps) {
  const pattern = formatIgnorePattern(path, isDirectory);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal-dialog git-ignore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ignore-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="git-ignore-heading">
          <span className="git-ignore-icon">
            {isDirectory ? <Folder size={18} /> : <FileText size={18} />}
          </span>
          <div>
            <h2 id="ignore-dialog-title">忽略“{basename(path)}”</h2>
            <span>{path}</span>
          </div>
        </div>

        <div className="git-ignore-preview">
          <GitBranch size={13} />
          <span>将写入规则</span>
          <code>{pattern}</code>
        </div>

        <fieldset className="git-ignore-scopes">
          <legend>规则范围</legend>
          <label className={scope === "project" ? "selected" : ""}>
            <input
              type="radio"
              name="ignore-scope"
              checked={scope === "project"}
              onChange={() => onScopeChange("project")}
            />
            <span>
              <strong>随仓库共享</strong>
              <code>.gitignore</code>
              <small>适合团队约定的私有目录和附件</small>
            </span>
          </label>
          <label className={scope === "local" ? "selected" : ""}>
            <input
              type="radio"
              name="ignore-scope"
              checked={scope === "local"}
              onChange={() => onScopeChange("local")}
            />
            <span>
              <strong>仅本机生效</strong>
              <code>.git/info/exclude</code>
              <small>不会把个人路径和隐私规则提交到仓库</small>
            </span>
          </label>
        </fieldset>

        <p className="git-ignore-warning">
          <AlertTriangle size={13} />
          已被 Git 跟踪的路径会停止跟踪，但本地文件不会被删除。停止跟踪会在仓库中产生一条待提交的删除记录。
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在应用..." : "添加忽略规则"}
          </button>
        </div>
      </div>
    </div>
  );
}
