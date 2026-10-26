import {
  Files,
  GitBranch,
  Link2,
  ListTree,
  Search,
  Settings,
  Tags,
} from "lucide-react";
import type { SidebarPanel } from "../types";

const items: Array<{
  id: SidebarPanel;
  label: string;
  hotkey: string;
  Icon: typeof Files;
}> = [
  { id: "files", label: "文件", hotkey: "Alt+1", Icon: Files },
  { id: "outline", label: "大纲", hotkey: "Alt+2", Icon: ListTree },
  { id: "search", label: "搜索", hotkey: "Ctrl+Shift+F", Icon: Search },
  { id: "tags", label: "标签", hotkey: "Alt+3", Icon: Tags },
  { id: "backlinks", label: "反向链接", hotkey: "Alt+4", Icon: Link2 },
  { id: "git", label: "Git", hotkey: "Ctrl+Shift+G", Icon: GitBranch },
];

interface ActivityRailProps {
  activePanel: SidebarPanel;
  gitChanges: number;
  onChange(panel: SidebarPanel): void;
}

export function ActivityRail({
  activePanel,
  gitChanges,
  onChange,
}: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label="左侧导航">
      {items.map(({ id, label, hotkey, Icon }) => (
        <button
          type="button"
          key={id}
          className={`rail-button ${activePanel === id ? "active" : ""}`}
          aria-label={`${label} (${hotkey})`}
          title={`${label} (${hotkey})`}
          onClick={() => onChange(id)}
        >
          <Icon size={18} />
          {id === "git" && gitChanges > 0 ? (
            <span className="rail-badge">{Math.min(gitChanges, 99)}</span>
          ) : null}
        </button>
      ))}
      <span className="rail-spacer" />
      <button
        type="button"
        className={`rail-button ${
          activePanel === "settings" ? "active" : ""
        }`}
        aria-label="设置"
        title="设置"
        onClick={() => onChange("settings")}
      >
        <Settings size={18} />
      </button>
    </nav>
  );
}
