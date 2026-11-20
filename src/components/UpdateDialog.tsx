import { useEffect, useRef } from "react";
import { Download, ShieldCheck, X } from "lucide-react";
import type { Updater } from "../lib/updater";

interface UpdateDialogProps {
  updater: Updater;
}

function formatSize(bytes: number): string {
  if (!bytes) {
    return "";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 只支持更新说明里常用的标题和列表，够用且不会误渲染任意 HTML。 */
function ReleaseNotes({ notes }: { notes: string }) {
  const lines = notes.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (!items.length) {
      return;
    }
    blocks.push(
      <ul key={`u-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<h3 key={`h-${blocks.length}`}>{heading[1]}</h3>);
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(bullet[1]);
      continue;
    }
    flush();
    blocks.push(<p key={`p-${blocks.length}`}>{line}</p>);
  }
  flush();
  if (!blocks.length) {
    return <p className="update-notes-empty">该版本没有填写更新说明。</p>;
  }
  return <>{blocks}</>;
}

export function UpdateDialog({ updater }: UpdateDialogProps) {
  const { state } = updater;
  const dialogRef = useRef<HTMLDivElement>(null);
  const visible =
    updater.dialogOpen &&
    (state.phase === "available" ||
      state.phase === "downloading" ||
      state.phase === "ready" ||
      state.phase === "error");

  useEffect(() => {
    if (!visible) {
      return;
    }
    const target = dialogRef.current?.querySelector<HTMLElement>(
      "button.update-primary, button.update-ghost",
    );
    target?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.phase !== "downloading") {
        event.preventDefault();
        updater.closeDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, state.phase, updater]);

  if (!visible) {
    return null;
  }

  const info = state.info;
  const size = formatSize(info?.sizeBytes || 0);
  const meta = [
    state.currentVersion ? `当前 ${state.currentVersion}` : "",
    formatDate(info?.publishedAt || ""),
    size,
  ]
    .filter(Boolean)
    .join(" · ");

  const close = () => {
    if (state.phase === "downloading") {
      return;
    }
    updater.closeDialog();
  };

  return (
    <div className="modal-backdrop update-backdrop" role="presentation">
      <div
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        ref={dialogRef}
      >
        <div className="update-head">
          <span className="update-icon" aria-hidden="true">
            <Download size={18} />
          </span>
          <div className="update-head-copy">
            <h2 id="update-dialog-title">
              {state.phase === "error"
                ? "检查更新失败"
                : state.phase === "downloading"
                  ? `正在下载 ${info?.version ?? ""}`
                  : state.phase === "ready"
                    ? "下载完成，可以安装"
                    : `发现新版本 ${info?.version ?? ""}`}
            </h2>
            <p className="update-meta">
              {state.phase === "error"
                ? "你的笔记不受影响，稍后会自动重试。"
                : state.phase === "ready" || state.phase === "downloading"
                  ? info?.fileName
                  : meta}
            </p>
          </div>
          <button
            type="button"
            className="update-close"
            aria-label="关闭"
            title="关闭"
            onClick={close}
            disabled={state.phase === "downloading"}
          >
            <X size={14} />
          </button>
        </div>

        <div className="update-body">
          {state.phase === "available" && info ? (
            <>
              <div className="update-notes">
                <ReleaseNotes notes={info.notes} />
              </div>
              <p className="update-trust">
                <ShieldCheck size={12} />
                从 GitHub Releases 下载 · 安装前校验 SHA-256
              </p>
            </>
          ) : null}

          {state.phase === "downloading" ? (
            <div className="update-progress">
              <div className="update-progress-top">
                <span>
                  <b>{Math.round(state.progress)}%</b>
                  {size ? ` · ${size}` : ""}
                </span>
                <span>正在从 GitHub Releases 下载</span>
              </div>
              <div className="update-bar">
                <i style={{ width: `${state.progress}%` }} />
              </div>
              {state.error ? (
                <p className="update-progress-error">{state.error}</p>
              ) : null}
            </div>
          ) : null}

          {state.phase === "ready" ? (
            <>
              {state.canInstallInApp ? (
                <p className="update-copy">
                  安装程序会关闭 Levil Notes，完成覆盖安装后自动重新打开。
                </p>
              ) : (
                <ol className="update-steps">
                  <li>点「打开安装包」，挂载 DMG</li>
                  <li>把 Levil Notes 拖到「应用程序」，覆盖旧版本</li>
                  <li>从启动台或程序坞重新打开</li>
                </ol>
              )}
              {!state.canInstallInApp ? (
                <p className="update-note">
                  当前版本未签名、未公证。首次打开如被拦截，请到「系统设置 ›
                  隐私与安全性」点「仍要打开」。
                </p>
              ) : null}
              <p className="update-trust">
                <ShieldCheck size={12} />
                {state.error
                  ? state.error
                  : "已校验 SHA-256 · 安装包未签名，SmartScreen 可能提示"}
              </p>
            </>
          ) : null}

          {state.phase === "error" ? (
            <>
              <div className="update-error-box">{state.error}</div>
              <p className="update-trust">
                <ShieldCheck size={12} />
                可以改用发布页手动下载安装
              </p>
            </>
          ) : null}
        </div>

        <div className="update-foot">
          <button
            type="button"
            className="update-link"
            onClick={() => void updater.skipVersion()}
          >
            跳过此版本
          </button>
          <span className="update-spacer" />
          {state.phase === "available" ? (
            <>
              <button
                type="button"
                className="update-ghost"
                onClick={close}
              >
                稍后
              </button>
              <button
                type="button"
                className="update-primary"
                onClick={() => void updater.download()}
                disabled={updater.busy}
              >
                下载并安装
              </button>
            </>
          ) : null}
          {state.phase === "downloading" ? (
            <button
              type="button"
              className="update-ghost"
              onClick={() => void updater.cancel()}
            >
              取消
            </button>
          ) : null}
          {state.phase === "ready" ? (
            <>
              <button type="button" className="update-ghost" onClick={close}>
                稍后
              </button>
              <button
                type="button"
                className="update-primary"
                onClick={() => void updater.install()}
              >
                {state.canInstallInApp ? "退出并安装" : "打开安装包"}
              </button>
            </>
          ) : null}
          {state.phase === "error" ? (
            <>
              <button
                type="button"
                className="update-ghost"
                onClick={close}
              >
                关闭
              </button>
              <button
                type="button"
                className="update-primary"
                onClick={() => void updater.check(true)}
                disabled={updater.busy}
              >
                重试
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
