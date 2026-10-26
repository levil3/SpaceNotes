import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const ALL_MATCHES_HIGHLIGHT = "spacenotes-find-all";
const ACTIVE_MATCH_HIGHLIGHT = "spacenotes-find-active";
const IGNORED_FIND_SELECTOR =
  ".tools, button, input, textarea, [aria-hidden='true'], " +
  ".language-picker, .milkdown-block-handle";

interface HighlightRegistryLike {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

interface HighlightInstanceLike {
  add(range: Range): void;
}

type HighlightConstructor = new () => HighlightInstanceLike;

interface NoteFindBarProps {
  documentRef: RefObject<HTMLDivElement | null>;
  content: string;
}

function findInTextNode(node: Text, query: string) {
  const ranges: Range[] = [];
  const text = node.data;
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let offset = 0;

  while (needle && offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) {
      break;
    }
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    ranges.push(range);
    offset = index + needle.length;
  }

  return ranges;
}

/**
 * Uses CSS Custom Highlight ranges instead of wrapping text in marker nodes.
 * That keeps ProseMirror's document structure and editing history untouched.
 */
function collectMatches(root: HTMLElement, query: string) {
  if (!query) {
    return [];
  }

  const contentRoot =
    root.querySelector<HTMLElement>(".ProseMirror") || root;
  const walker = document.createTreeWalker(
    contentRoot,
    NodeFilter.SHOW_TEXT,
  );
  const ranges: Range[] = [];
  let node = walker.nextNode();

  while (node) {
    const text = node as Text;
    const parent = text.parentElement;
    if (
      text.data &&
      parent &&
      !parent.closest(IGNORED_FIND_SELECTOR) &&
      parent.getClientRects().length > 0
    ) {
      ranges.push(...findInTextNode(text, query));
    }
    node = walker.nextNode();
  }

  return ranges;
}

function getHighlightSupport() {
  const registry = (
    globalThis.CSS as unknown as {
      highlights?: HighlightRegistryLike;
    }
  )?.highlights;
  const HighlightClass = (
    globalThis as unknown as {
      Highlight?: HighlightConstructor;
    }
  ).Highlight;
  return registry && HighlightClass
    ? { registry, HighlightClass }
    : null;
}

function clearHighlights() {
  const support = getHighlightSupport();
  support?.registry.delete(ALL_MATCHES_HIGHLIGHT);
  support?.registry.delete(ACTIVE_MATCH_HIGHLIGHT);
}

export function NoteFindBar({
  documentRef,
  content,
}: NoteFindBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const closeFinder = () => {
    setOpen(false);
    window.setTimeout(() => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    }, 0);
  };

  const moveToMatch = (step: number) => {
    if (!matches.length) {
      return;
    }
    setActiveIndex(
      (current) => (current + step + matches.length) % matches.length,
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        if (!open) {
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }
        setOpen(true);
        window.setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        closeFinder();
      } else if (open && event.key === "F3") {
        event.preventDefault();
        moveToMatch(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [matches.length, open]);

  useEffect(() => {
    if (!open) {
      setMatches([]);
      clearHighlights();
      return;
    }

    const root = documentRef.current;
    if (!root) {
      return;
    }

    let refreshTimer = 0;
    const refresh = () => {
      const nextMatches = collectMatches(root, query);
      setMatches(nextMatches);
      setActiveIndex((current) =>
        nextMatches.length
          ? Math.min(current, nextMatches.length - 1)
          : 0,
      );
    };
    refresh();

    const observer = new MutationObserver(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refresh, 80);
    });
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      window.clearTimeout(refreshTimer);
    };
  }, [content, documentRef, open, query]);

  useEffect(() => {
    const support = getHighlightSupport();
    if (!support) {
      return;
    }

    support.registry.delete(ALL_MATCHES_HIGHLIGHT);
    support.registry.delete(ACTIVE_MATCH_HIGHLIGHT);
    if (!open || !matches.length) {
      return;
    }

    const allRanges = new support.HighlightClass();
    matches.forEach((range) => allRanges.add(range));
    support.registry.set(ALL_MATCHES_HIGHLIGHT, allRanges);

    const activeRange = matches[activeIndex];
    if (activeRange) {
      const activeHighlight = new support.HighlightClass();
      activeHighlight.add(activeRange);
      support.registry.set(ACTIVE_MATCH_HIGHLIGHT, activeHighlight);
    }

    return () => {
      support.registry.delete(ALL_MATCHES_HIGHLIGHT);
      support.registry.delete(ACTIVE_MATCH_HIGHLIGHT);
    };
  }, [activeIndex, matches, open]);

  useEffect(() => {
    if (!open || !matches[activeIndex]) {
      return;
    }

    const container = documentRef.current?.closest(".editor-mount");
    const rect = matches[activeIndex].getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();
    if (
      container &&
      containerRect &&
      (rect.top < containerRect.top + 90 ||
        rect.bottom > containerRect.bottom - 48)
    ) {
      container.scrollBy({
        top: rect.top - containerRect.top - containerRect.height * 0.34,
        behavior: "smooth",
      });
    }
  }, [activeIndex, documentRef, matches, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="note-find-layer">
      <div className="note-find-bar" role="search" aria-label="在当前笔记中查找">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              moveToMatch(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="在当前笔记中查找"
          aria-label="在当前笔记中查找"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="note-find-count" aria-live="polite">
          {matches.length ? activeIndex + 1 : 0} / {matches.length}
        </span>
        <button
          type="button"
          className="icon-button"
          title="上一个匹配项"
          aria-label="上一个匹配项"
          disabled={!matches.length}
          onClick={() => moveToMatch(-1)}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="下一个匹配项"
          aria-label="下一个匹配项"
          disabled={!matches.length}
          onClick={() => moveToMatch(1)}
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="关闭查找"
          aria-label="关闭查找"
          onClick={closeFinder}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
