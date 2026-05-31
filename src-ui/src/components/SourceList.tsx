import type { SourceRef } from "../types";

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return <p className="muted">No sources returned yet.</p>;
  }

  return (
    <div className="source-list">
      {sources.slice(0, 18).map((source, index) => (
        <div className="source-row" key={`${source.filePath}-${source.kind}-${source.name}-${source.lines}`}>
          <span className="source-index">{index + 1}</span>
          <div>
            <strong>{source.filePath}</strong>
            <span>
              {source.kind} · {source.name} · lines {source.lines}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
