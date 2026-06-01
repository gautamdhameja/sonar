import { CheckCircle2, Info, X } from "lucide-react";
import type { CitationVerification, SourceRef } from "../types";
import { SourceList } from "./SourceList";

interface EvidenceDrawerProps {
  citation?: CitationVerification | null;
  sources: SourceRef[];
  onClose: () => void;
}

export function EvidenceDrawer({ citation, sources, onClose }: EvidenceDrawerProps) {
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Sources Sonar used</h2>
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
