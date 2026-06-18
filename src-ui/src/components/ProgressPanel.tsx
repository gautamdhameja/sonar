import { CheckCircle2, Loader2, StopCircle } from "lucide-react";
import type { ActiveTask } from "../app/types";

interface ProgressPanelProps {
  activeTask: ActiveTask;
  onStop: () => void;
  stopDisabled: boolean;
}

export function ProgressPanel({ activeTask, onStop, stopDisabled }: ProgressPanelProps) {
  const progress = activeTask.progress ?? (activeTask.kind === "brief" ? 82 : activeTask.kind === "followup" ? 55 : 25);
  const canStop = activeTask.canStop ?? activeTask.kind === "brief";
  const steps =
    activeTask.kind === "brief"
      ? [
          { label: "Inventory", active: progress < 64, done: progress >= 64 },
          { label: "Inspect", active: progress >= 64 && progress < 76, done: progress >= 76 },
          { label: "Map", active: progress >= 76 && progress < 88, done: progress >= 88 },
          { label: "Brief", active: progress >= 88, done: false },
        ]
      : [
          {
            label: "Import",
            active: activeTask.label.includes("Importing"),
            done: progress > 25 || activeTask.kind === "followup",
          },
          {
            label: "Prepare",
            active: activeTask.label.includes("Preparing"),
            done: progress > 45 || activeTask.kind === "followup",
          },
          {
            label: "Index",
            active: activeTask.label.includes("Indexing"),
            done: progress > 78 || activeTask.kind === "followup",
          },
          {
            label: activeTask.kind === "followup" ? "Answer" : "Brief",
            active: activeTask.kind === "followup",
            done: false,
          },
        ];

  return (
    <section className="progress-panel">
      <div>
        <p className="eyebrow">Preparing Briefing</p>
        <h2>{activeTask.label}</h2>
        {activeTask.detail && <p className="progress-detail">{activeTask.detail}</p>}
      </div>
      <div className="progress-meter">
        <div className="progress-meter-row">
          <span>{progress}%</span>
          <span>{activeTask.kind === "brief" ? "Surveying" : "Working"}</span>
        </div>
        <div
          aria-label={activeTask.label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="progress-track"
          role="progressbar"
        >
          <span
            className={activeTask.kind === "brief" ? "progress-fill indeterminate" : "progress-fill"}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="progress-steps">
        {steps.map((step) => (
          <div
            className={step.active ? "progress-step active" : step.done ? "progress-step done" : "progress-step"}
            key={step.label}
          >
            <span>
              {step.done ? <CheckCircle2 size={14} /> : step.active ? <Loader2 className="spin" size={14} /> : null}
            </span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </div>
      {(activeTask.kind === "analyze" || activeTask.kind === "brief") && canStop && (
        <button className="quiet-danger" disabled={stopDisabled || !canStop} onClick={onStop} type="button">
          <StopCircle size={16} />
          {activeTask.kind === "brief" ? "Cancel generation" : "Stop analysis"}
        </button>
      )}
    </section>
  );
}
