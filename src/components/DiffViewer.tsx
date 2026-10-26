import { FileDiff, FileSearch, GitCommitHorizontal } from "lucide-react";

interface DiffViewerProps {
  title: string;
  subtitle: string;
  diff: string;
  mode: "working" | "preview" | "commit";
}

export function DiffViewer({
  title,
  subtitle,
  diff,
  mode,
}: DiffViewerProps) {
  return (
    <div className="diff-view">
      <div className="diff-view-heading">
        <div className="diff-heading-icon">
          {mode === "working" ? (
            <FileDiff size={18} />
          ) : mode === "preview" ? (
            <FileSearch size={18} />
          ) : (
            <GitCommitHorizontal size={18} />
          )}
        </div>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <pre className="diff-content">
        {diff.split(/\r?\n/).map((line, index) => {
          let className = "diff-line";
          if (line.startsWith("+") && !line.startsWith("+++")) {
            className += " added";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            className += " removed";
          } else if (line.startsWith("@@")) {
            className += " hunk";
          } else if (
            line.startsWith("diff --git") ||
            line.startsWith("index ") ||
            line.startsWith("---") ||
            line.startsWith("+++")
          ) {
            className += " meta";
          }
          return (
            <span key={`${index}-${line.slice(0, 16)}`} className={className}>
              {line || " "}
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
