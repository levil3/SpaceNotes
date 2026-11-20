import { Check, RotateCcw } from "lucide-react";
import brandMark from "../../../resources/icon.svg";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
} from "../../lib/editorZoom";
import type { AppSettings, ThemeMode } from "../../types";
import type { Updater } from "../../lib/updater";

// Presets only change document colors; layout and saved notes remain untouched.
const themePresets = [
  {
    name: "文档极简",
    values: {
      themeMode: "light" as const,
      background: "#ffffff",
      textColor: "#222222",
      accent: "#4b708b",
    },
  },
  {
    name: "象牙纸",
    values: {
      themeMode: "light" as const,
      background: "#f8f6f0",
      textColor: "#34312c",
      accent: "#8a6944",
    },
  },
  {
    name: "清透白纸",
    values: {
      themeMode: "light" as const,
      background: "#fbfcfa",
      textColor: "#28312d",
      accent: "#187a68",
    },
  },
  {
    name: "雾蓝纸",
    values: {
      themeMode: "light" as const,
      background: "#f4f7fa",
      textColor: "#263442",
      accent: "#3f6e96",
    },
  },
  {
    name: "松林纸",
    values: {
      themeMode: "light" as const,
      background: "#f4f7f4",
      textColor: "#29352e",
      accent: "#44745c",
    },
  },
  {
    name: "暖灰纸",
    values: {
      themeMode: "light" as const,
      background: "#f3f0ea",
      textColor: "#393631",
      accent: "#75685a",
    },
  },
  {
    name: "海盐蓝",
    values: {
      themeMode: "light" as const,
      background: "#f5f8f8",
      textColor: "#263638",
      accent: "#357b82",
    },
  },
  {
    name: "暮光棕",
    values: {
      themeMode: "light" as const,
      background: "#faf7f3",
      textColor: "#3e332e",
      accent: "#986348",
    },
  },
  {
    name: "极夜蓝",
    values: {
      themeMode: "dark" as const,
      background: "#171b20",
      textColor: "#dce4ec",
      accent: "#77a5ff",
    },
  },
  {
    name: "石墨灰",
    values: {
      themeMode: "dark" as const,
      background: "#1f2023",
      textColor: "#e6e6e6",
      accent: "#8ab4f8",
    },
  },
  {
    name: "深海青",
    values: {
      themeMode: "dark" as const,
      background: "#0f1b24",
      textColor: "#d7e6ee",
      accent: "#63b3d1",
    },
  },
  {
    name: "森林夜",
    values: {
      themeMode: "dark" as const,
      background: "#121913",
      textColor: "#dbe7dd",
      accent: "#72bb91",
    },
  },
  {
    name: "暖夜棕",
    values: {
      themeMode: "dark" as const,
      background: "#211b18",
      textColor: "#eadfd7",
      accent: "#d19a66",
    },
  },
];

const defaults: AppSettings = {
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
  autoCheckUpdates: true,
  skippedUpdateVersion: "",
  lastUpdateCheckAt: 0,
};

interface SettingsPanelProps {
  settings: AppSettings;
  onChange(updates: Partial<AppSettings>): void;
  updater: Updater;
}

export function SettingsPanel({
  settings,
  onChange,
  updater,
}: SettingsPanelProps) {
  const setThemeMode = (themeMode: ThemeMode) => onChange({ themeMode });
  const update = updater.state;
  const updateStateText = updater.skipped
    ? `已跳过 ${update.info?.version ?? ""}`
    : update.phase === "checking"
      ? "正在检查更新…"
      : update.phase === "downloading"
        ? `正在下载 ${Math.round(update.progress)}%`
        : update.phase === "ready"
          ? `${update.info?.version ?? ""} 已下载，待安装`
          : update.phase === "available"
            ? `有新版本 ${update.info?.version ?? ""}`
            : update.phase === "latest"
              ? "已是最新版本"
              : update.phase === "error"
                ? "检查更新失败"
                : "检查更新，获取最新版本与修复。";
  const updateStateTone =
    updater.skipped || update.phase === "idle"
      ? "idle"
      : update.phase === "latest"
        ? "ok"
        : update.phase === "error"
          ? "error"
          : "new";

  return (
    <div className="side-panel-content settings-panel">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">应用</span>
          <strong>外观设置</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          title="恢复默认外观"
          aria-label="恢复默认外观"
          onClick={() =>
            onChange({
              themeMode: defaults.themeMode,
              accent: defaults.accent,
              background: defaults.background,
              textColor: defaults.textColor,
              editorFontSize: defaults.editorFontSize,
              contentWidth: defaults.contentWidth,
            })
          }
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <section className="settings-section">
        <span className="settings-label">显示模式</span>
        <div className="segmented three-up">
          {(["light", "dark", "system"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={settings.themeMode === mode ? "active" : ""}
              onClick={() => setThemeMode(mode)}
            >
              {mode === "light"
                ? "浅色"
                : mode === "dark"
                  ? "深色"
                  : "跟随系统"}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-toggle-row">
          <span className="settings-toggle-copy">
            <strong>显示隐藏目录和文件</strong>
            <small>显示以 . 开头的目录和 Markdown 笔记</small>
          </span>
          <button
            type="button"
            className="settings-switch"
            role="switch"
            aria-label="显示隐藏目录和文件"
            aria-checked={settings.showHiddenFiles}
            title={
              settings.showHiddenFiles
                ? "隐藏以 . 开头的目录和笔记"
                : "显示以 . 开头的目录和笔记"
            }
            onClick={() =>
              onChange({ showHiddenFiles: !settings.showHiddenFiles })
            }
          >
            <span />
          </button>
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-label">主题预设</span>
        <div className="preset-list">
          {themePresets.map((preset) => {
            const selected =
              settings.themeMode === preset.values.themeMode &&
              settings.background === preset.values.background &&
              settings.textColor === preset.values.textColor &&
              settings.accent === preset.values.accent;
            return (
              <button
                type="button"
                key={preset.name}
                className={`theme-preset ${selected ? "selected" : ""}`}
                onClick={() => onChange(preset.values)}
                title={`${preset.name}主题`}
              >
                <span
                  className="preset-preview"
                  style={{
                    background: preset.values.background,
                    color: preset.values.textColor,
                  }}
                  aria-hidden="true"
                >
                  <span className="preset-preview-sidebar" />
                  <span className="preset-preview-page">
                    <span className="preset-preview-title" />
                    <span className="preset-preview-line" />
                    <span className="preset-preview-line short" />
                    <span
                      className="preset-preview-accent"
                      style={{ background: preset.values.accent }}
                    />
                  </span>
                </span>
                <span className="preset-name">
                  <strong>{preset.name}</strong>
                  <small>
                    {preset.values.themeMode === "dark" ? "深色" : "浅色"}
                  </small>
                </span>
                {selected ? (
                  <Check className="preset-check" size={13} />
                ) : (
                  <span className="preset-check" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-label">自定义颜色</span>
        <label className="color-setting">
          <span>强调色</span>
          <span className="color-input-wrap">
            <input
              type="color"
              value={settings.accent}
              onChange={(event) => onChange({ accent: event.target.value })}
            />
            <code>{settings.accent.toUpperCase()}</code>
          </span>
        </label>
        <label className="color-setting">
          <span>背景色</span>
          <span className="color-input-wrap">
            <input
              type="color"
              value={settings.background}
              onChange={(event) => onChange({ background: event.target.value })}
            />
            <code>{settings.background.toUpperCase()}</code>
          </span>
        </label>
        <label className="color-setting">
          <span>正文颜色</span>
          <span className="color-input-wrap">
            <input
              type="color"
              value={settings.textColor}
              onChange={(event) => onChange({ textColor: event.target.value })}
            />
            <code>{settings.textColor.toUpperCase()}</code>
          </span>
        </label>
      </section>

      <section className="settings-section">
        <label className="range-setting">
          <span className="settings-label">正文字号</span>
          <span>{settings.editorFontSize}px</span>
          <input
            type="range"
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            step="1"
            value={settings.editorFontSize}
            onChange={(event) =>
              onChange({ editorFontSize: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-setting">
          <span className="settings-label">阅读宽度</span>
          <span>{settings.contentWidth}px</span>
          <input
            type="range"
            min="760"
            max="1280"
            step="20"
            value={settings.contentWidth}
            onChange={(event) =>
              onChange({ contentWidth: Number(event.target.value) })
            }
          />
        </label>
      </section>

      <section className="settings-section update-about">
        <div className="update-about-head">
          <img className="update-about-mark" src={brandMark} alt="" />
          <span>
            <strong>Levil Notes</strong>
            <small>版本 {update.currentVersion || "—"}</small>
          </span>
        </div>
        <p className={`update-about-state ${updateStateTone}`}>
          {updateStateText}
        </p>
        <div className="update-about-actions">
          <button
            type="button"
            className="update-about-button"
            onClick={() => void updater.check(true)}
            disabled={updater.busy || update.phase === "checking"}
          >
            {update.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
          {update.phase === "available" ||
          update.phase === "ready" ||
          update.phase === "downloading" ? (
            <button
              type="button"
              className="update-about-link"
              onClick={() => updater.openDialog()}
            >
              查看
            </button>
          ) : null}
          {updater.skipped || update.phase === "error" ? (
            <button
              type="button"
              className="update-about-link"
              onClick={() =>
                void (updater.skipped
                  ? updater.unskipVersion()
                  : updater.check(true))
              }
            >
              {updater.skipped ? "恢复提示" : "重试"}
            </button>
          ) : null}
        </div>
        <div className="update-about-toggle">
          <span>
            启动时自动检查
            <small>每 24 小时最多一次</small>
          </span>
          <button
            type="button"
            className="settings-switch"
            role="switch"
            aria-label="启动时自动检查更新"
            aria-checked={settings.autoCheckUpdates}
            onClick={() =>
              onChange({ autoCheckUpdates: !settings.autoCheckUpdates })
            }
          >
            <span />
          </button>
        </div>
      </section>
    </div>
  );
}
