import { Settings } from "lucide-react";
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
        <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" />
        <div className="brand-copy">
          <h1>Sonar</h1>
          <p>First-week codebase briefing</p>
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
