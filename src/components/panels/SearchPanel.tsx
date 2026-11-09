import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { SearchResult } from "../../types";

export type SearchScope = "all" | "title" | "content";
export type SearchMode = "smart" | "exact";

interface SearchPanelProps {
  // The query lives in App so switching panels does not throw it away and a
  // tag click can seed it without resurrecting on the next mount.
  query: string;
  scope: SearchScope;
  mode: SearchMode;
  onQueryChange(value: string): void;
  onScopeChange(value: SearchScope): void;
  onModeChange(value: SearchMode): void;
  /** Snapshot revision; results must refresh when the index changed. */
  revision: number;
  onOpenResult(result: SearchResult): void;
}

export function SearchPanel({
  query,
  scope,
  mode,
  onQueryChange,
  onScopeChange,
  onModeChange,
  revision,
  onOpenResult,
}: SearchPanelProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchError("");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const nextResults = await window.levilNotes.search(query, scope, mode);
        if (!cancelled) {
          setResults(nextResults);
          setSearchError("");
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            String(error instanceof Error ? error.message : error),
          );
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, scope, mode, revision]);

  return (
    <div className="side-panel-content">
      <div className="panel-title-row">
        <div>
          <span className="panel-kicker">全文检索</span>
          <strong>搜索</strong>
        </div>
        <span className="panel-meta">{results.length} 条</span>
      </div>

      <label className="search-box prominent">
        <Search size={15} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索标题或正文"
        />
      </label>

      <div className="search-controls">
        <div className="segmented compact" aria-label="搜索范围">
          {(["all", "title", "content"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={scope === value ? "active" : ""}
              onClick={() => onScopeChange(value)}
            >
              {value === "all" ? "全部" : value === "title" ? "标题" : "正文"}
            </button>
          ))}
        </div>
        <select
          aria-label="搜索匹配方式"
          value={mode}
          onChange={(event) =>
            onModeChange(event.target.value as SearchMode)
          }
        >
          <option value="smart">智能匹配</option>
          <option value="exact">精确匹配</option>
        </select>
      </div>

      <div className="search-results">
        {searching ? (
          <div className="panel-empty">正在搜索...</div>
        ) : searchError ? (
          <div className="panel-empty">{searchError}</div>
        ) : query && !results.length ? (
          <div className="panel-empty">
            <Search size={22} />
            <span>没有找到匹配内容</span>
          </div>
        ) : (
          results.map((result) => (
            <button
              key={`${result.path}-${result.matchKind}`}
              type="button"
              className="search-result"
              onClick={() => onOpenResult(result)}
            >
              <span className="result-heading">
                <span className="result-kind">
                  {result.matchKind === "title" ? "标题" : "正文"}
                </span>
                <strong>{result.title}</strong>
              </span>
              <span className="result-path">{result.path}</span>
              <span className="result-snippet">{result.snippet}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
