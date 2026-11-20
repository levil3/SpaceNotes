import {
  FileText,
  List,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const stripRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  const switcherListRef = useRef<HTMLDivElement>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const activeTabId = tabs.find((tab) => tab.active)?.id || "";

  // Tabs keep their full title, so the strip scrolls instead of squeezing.
  // The edge fades tell the user there is more on either side.
  const syncEdges = useCallback(() => {
    const strip = stripRef.current;
    const wrap = wrapRef.current;
    if (!strip || !wrap) {
      return;
    }
    wrap.classList.toggle("can-left", strip.scrollLeft > 2);
    wrap.classList.toggle(
      "can-right",
      strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2,
    );
  }, []);

  // Resizing the window can push the active tab out of view.
  const revealActive = useCallback(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !active) {
      return;
    }
    const stripBox = strip.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.left < stripBox.left || activeBox.right > stripBox.right) {
      active.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    syncEdges();
    strip.addEventListener("scroll", syncEdges, { passive: true });
    const observer = new ResizeObserver(() => {
      syncEdges();
      revealActive();
    });
    observer.observe(strip);
    return () => {
      strip.removeEventListener("scroll", syncEdges);
      observer.disconnect();
    };
  }, [syncEdges, revealActive]);

  useEffect(() => {
    syncEdges();
  }, [tabs, activeTabId, syncEdges]);

  // Keep the active tab reachable when the strip has more tabs than width.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    if (tabs.length < 2) {
      setSwitcherOpen(false);
    }
  }, [tabs.length]);

  // Close the document switcher on outside click or Escape, and put focus on
  // the active document so keyboard users can keep going from there.
  useEffect(() => {
    if (!switcherOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSwitcherOpen(false);
        switcherButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const activeRow = switcherListRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    activeRow?.focus();
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [switcherOpen]);

  const handleSwitcherKeys = (event: React.KeyboardEvent) => {
    const items = [
      ...(switcherListRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ) ?? []),
    ];
    if (!items.length) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(
        items.length - 1,
        Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      items[next].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  };

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

      <div className="tab-strip-wrap" ref={wrapRef}>
        <div
          ref={stripRef}
          className="tab-strip"
          role="tablist"
          aria-label="已打开的笔记"
          onKeyDown={(event) => {
            const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
            if (!keys.includes(event.key)) {
              return;
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
            ];
            const index = items.findIndex(
              (item) => item.getAttribute("aria-selected") === "true",
            );
            if (index < 0) {
              return;
            }
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : Math.min(
                      items.length - 1,
                      Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)),
                    );
            const target = items[next];
            const id = target.dataset.tabId;
            target.focus();
            if (id) {
              onSelectTab(id);
            }
          }}
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
            <div
              key={tab.id}
              role="tab"
              data-tab-id={tab.id}
              aria-selected={tab.active}
              tabIndex={tab.active ? 0 : -1}
              title={
                tab.vaultName
                  ? `${tab.title} · ${tab.vaultName}`
                  : tab.title
              }
              className={`note-tab ${tab.active ? "active" : ""}`}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              <FileText size={13} />
              <span className="tab-title">{tab.title}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={`关闭 ${tab.title}`}
                title={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {tabs.length > 1 ? (
        <div className="tab-switcher" ref={switcherRef}>
          <button
            ref={switcherButtonRef}
            type="button"
            className="icon-button tab-switcher-button"
            aria-haspopup="menu"
            aria-expanded={switcherOpen}
            aria-label={`已打开的文档（${tabs.length}）`}
            title="已打开的文档"
            onClick={() => setSwitcherOpen((open) => !open)}
          >
            <List size={15} />
            <span className="tab-switcher-count">{tabs.length}</span>
          </button>
          {switcherOpen ? (
            <div
              className="tab-switcher-menu"
              role="menu"
              aria-label="已打开的文档"
              onKeyDown={handleSwitcherKeys}
            >
              <div className="tab-switcher-head">
                已打开的文档 · {tabs.length}
              </div>
              <div className="tab-switcher-list" ref={switcherListRef}>
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    role="menuitem"
                    tabIndex={-1}
                    data-active={tab.active}
                    className={`tab-switcher-row ${tab.active ? "active" : ""}`}
                    onClick={() => {
                      onSelectTab(tab.id);
                      setSwitcherOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectTab(tab.id);
                        setSwitcherOpen(false);
                      }
                    }}
                  >
                    <FileText size={13} className="tab-switcher-icon" />
                    <span className="tab-switcher-title">{tab.title}</span>
                    {tab.vaultName ? (
                      <span className="tab-switcher-vault">{tab.vaultName}</span>
                    ) : null}
                    <button
                      type="button"
                      className="tab-switcher-close"
                      aria-label={`关闭 ${tab.title}`}
                      title={`关闭 ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="tab-switcher-foot">
                <span>{formatShortcut("Ctrl+W")} 关闭当前文档</span>
                <span>中键关闭标签</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        className="icon-button tab-add"
        aria-label="新建笔记"
        title="新建笔记"
        onClick={onNewNote}
      >
        <Plus size={17} />
      </button>

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
