import {
  FileText,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import dogMark from "../../resources/icon.svg";
import { formatShortcut } from "../lib/shortcutLabels";

interface OpenTab {
  id: string;
  title: string;
  vaultName: string;
  active: boolean;
}

interface TopBarProps {
  tabs: OpenTab[];
  sidebarCollapsed: boolean;
  onSelectTab(id: string): void;
  onCloseTab(id: string): void;
  onToggleSidebar(): void;
  onNewNote(): void;
  onShowVaultMenu(): void;
}

export function TopBar({
  tabs,
  sidebarCollapsed,
  onSelectTab,
  onCloseTab,
  onToggleSidebar,
  onNewNote,
  onShowVaultMenu,
}: TopBarProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  const activeTabId = tabs.find((tab) => tab.active)?.id || "";

  // Keep the active tab reachable when the strip has more tabs than width.
  useEffect(() => {
    tabStripRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId, tabs.length]);

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
          title={`${sidebarCollapsed ? "展开侧栏" : "收起侧栏"} (${formatShortcut("Ctrl+B")})`}
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

      <div
        ref={tabStripRef}
        className="tab-strip"
        role="tablist"
        aria-label="已打开的笔记"
        onWheel={(event) => {
          const strip = event.currentTarget;
          if (strip.scrollWidth <= strip.clientWidth) {
            return;
          }
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
            return;
          }
          // A vertical wheel over the tab strip scrolls through tabs.
          strip.scrollLeft += event.deltaY;
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.active}
            title={
              tab.vaultName
                ? `${tab.title} · ${tab.vaultName}`
                : tab.title
            }
            className={`note-tab ${tab.active ? "active" : ""}`}
            onClick={() => onSelectTab(tab.id)}
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
                onCloseTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  onCloseTab(tab.id);
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
