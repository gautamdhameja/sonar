import type { SourceRef } from "../types";

function isDocumentationSource(source: SourceRef): boolean {
  return /^(readme|docs\/|.*\.mdx?$)/i.test(source.filePath);
}

function orderSources(sources: SourceRef[]): SourceRef[] {
  return [...sources].sort((a, b) => {
    const codeDelta = Number(!isDocumentationSource(b)) - Number(!isDocumentationSource(a));
    if (codeDelta !== 0) return codeDelta;
    return a.filePath.localeCompare(b.filePath) || a.lines.localeCompare(b.lines);
  });
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return <p className="muted">No sources returned yet.</p>;
  }

  const orderedSources = orderSources(sources);

  return (
    <div className="source-list">
      {orderedSources.slice(0, 18).map((source, index) => (
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
