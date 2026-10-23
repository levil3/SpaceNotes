import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { SearchResult } from "../../types";

interface SearchPanelProps {
  initialQuery?: string;
  onOpenResult(result: SearchResult): void;
}

export function SearchPanel({
  initialQuery = "",
  onOpenResult,
}: SearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<"all" | "title" | "content">("all");
  const [mode, setMode] = useState<"smart" | "exact">("smart");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const nextResults = await window.levilNotes.search(query, scope, mode);
        if (!cancelled) {
          setResults(nextResults);
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
  }, [query, scope, mode]);

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
          onChange={(event) => setQuery(event.target.value)}
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
              onClick={() => setScope(value)}
            >
              {value === "all" ? "全部" : value === "title" ? "标题" : "正文"}
            </button>
          ))}
        </div>
        <select
          aria-label="搜索匹配方式"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as "smart" | "exact")
          }
        >
          <option value="smart">智能匹配</option>
          <option value="exact">精确匹配</option>
        </select>
      </div>

      <div className="search-results">
        {searching ? (
          <div className="panel-empty">正在搜索...</div>
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
