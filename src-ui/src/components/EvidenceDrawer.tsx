import { CheckCircle2, Info, X } from "lucide-react";
import { useDialog } from "../app/useDialog";
import type { CitationVerification, SourceRef } from "../types";
import { SourceList } from "./SourceList";

interface EvidenceDrawerProps {
  citation?: CitationVerification | null;
  sources: SourceRef[];
  onClose: () => void;
}

export function EvidenceDrawer({ citation, sources, onClose }: EvidenceDrawerProps) {
  const panelRef = useDialog<HTMLElement>(onClose);

  return (
    <div className="drawer-backdrop" role="presentation">
      <button aria-label="Close evidence panel" className="drawer-scrim" onClick={onClose} type="button" />
      <aside
        aria-labelledby="evidence-title"
        aria-modal="true"
        className="drawer"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2 id="evidence-title">Sources Sonar used</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        {citation && (
          <div className={citation.valid ? "evidence-summary good" : "evidence-summary warn"}>
            {citation.valid ? <CheckCircle2 size={18} /> : <Info size={18} />}
            <span>
              {citation.valid
                ? "All cited source references match the retrieved context."
                : `${citation.uncitedClaims.length} generated claims should be reviewed.`}
            </span>
          </div>
        )}
        <SourceList sources={sources} />
      </aside>
    </div>
  );
}
