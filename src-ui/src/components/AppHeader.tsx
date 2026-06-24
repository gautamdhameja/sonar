import { Settings } from "lucide-react";
import brandMark from "../assets/brand-mark.png";
import type { ServiceState } from "../types";
import { stateLabel } from "../app/format";

interface AppHeaderProps {
  runtime: ServiceState;
  onRefreshServices: () => void;
  onOpenSettings: () => void;
}

export function AppHeader({ runtime, onRefreshServices, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark-frame" aria-hidden="true">
          <img className="brand-mark" src={brandMark} alt="" />
        </span>
        <div className="brand-copy">
          <h1>Sonar</h1>
          <p>Local-first codebase briefings for people who need project context, not implementation detail.</p>
        </div>
      </div>
      <div className="header-actions">
        <button className={`status-pill ${runtime}`} onClick={onRefreshServices} type="button">
          <span />
          {stateLabel(runtime)}
        </button>
        <button className="ghost-button" onClick={onOpenSettings} type="button">
          <Settings size={16} />
          Settings
        </button>
      </div>
    </header>
  );
}
