import { Check, RotateCcw } from "lucide-react";
import type { AppSettings, ThemeMode } from "../../types";

// Presets only change document colors; layout and saved notes remain untouched.
const themePresets = [
  {
    name: "文档极简",
    values: {
      themeMode: "light" as const,
      background: "#ffffff",
      textColor: "#333333",
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

interface SettingsPanelProps {
  settings: AppSettings;
  onChange(updates: Partial<AppSettings>): void;
}

export function SettingsPanel({
  settings,
  onChange,
}: SettingsPanelProps) {
  const setThemeMode = (themeMode: ThemeMode) => onChange({ themeMode });

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
            min="13"
            max="21"
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
    </div>
  );
}
