import {
  FileText,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import dogMark from "../../resources/icon.svg";

interface OpenTab {
  path: string;
  title: string;
}

interface TopBarProps {
  tabs: OpenTab[];
  activePath: string;
  sidebarCollapsed: boolean;
  onSelectTab(path: string): void;
  onCloseTab(path: string): void;
  onToggleSidebar(): void;
  onNewNote(): void;
  onShowVaultMenu(): void;
}

export function TopBar({
  tabs,
  activePath,
  sidebarCollapsed,
  onSelectTab,
  onCloseTab,
  onToggleSidebar,
  onNewNote,
  onShowVaultMenu,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button
          className="icon-button brand-button"
          aria-label="打开笔记库菜单"
          title="笔记库"
          onClick={onShowVaultMenu}
        >
          <img className="brand-mark" src={dogMark} alt="" />
        </button>
        <button
          className="icon-button"
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          title={sidebarCollapsed ? "展开侧栏 (Ctrl+B)" : "收起侧栏 (Ctrl+B)"}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
        <span className="topbar-menu-hint">
          <Menu size={15} />
        </span>
      </div>

      <div className="tab-strip" role="tablist" aria-label="已打开的笔记">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            type="button"
            role="tab"
            aria-selected={tab.path === activePath}
            className={`note-tab ${tab.path === activePath ? "active" : ""}`}
            onClick={() => onSelectTab(tab.path)}
          >
            <FileText size={13} />
            <span className="tab-title">{tab.title}</span>
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              aria-label={`关闭 ${tab.title}`}
              title={`关闭 ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.path);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  onCloseTab(tab.path);
                }
              }}
            >
              <X size={12} />
            </span>
          </button>
        ))}
        <button
          className="icon-button tab-add"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onNewNote}
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="window-controls">
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={() => window.levilNotes.minimizeWindow()}
        >
          <span className="window-minimize" />
        </button>
        <button
          type="button"
          aria-label="最大化或还原"
          title="最大化或还原"
          onClick={() => window.levilNotes.toggleMaximizeWindow()}
        >
          <span className="window-maximize" />
        </button>
        <button
          type="button"
          aria-label="关闭"
          title="关闭"
          className="window-close"
          onClick={() => window.levilNotes.closeWindow()}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
