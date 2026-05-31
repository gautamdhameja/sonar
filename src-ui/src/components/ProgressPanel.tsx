import { CheckCircle2, Loader2, StopCircle } from "lucide-react";
import type { ActiveTask } from "../app/types";

interface ProgressPanelProps {
  activeTask: ActiveTask;
  onStop: () => void;
  stopDisabled: boolean;
}

export function ProgressPanel({ activeTask, onStop, stopDisabled }: ProgressPanelProps) {
  const steps = [
    {
      label: "Import repository",
      active: activeTask.label.includes("Cloning") || activeTask.label.includes("Preparing"),
      done: activeTask.kind === "brief",
    },
    {
      label: "Build local index",
      active: activeTask.label.includes("Indexing"),
      done: activeTask.kind === "brief",
    },
    {
      label: "Write first-week briefing",
      active: activeTask.kind === "brief",
      done: false,
    },
  ];

  return (
    <section className="progress-panel">
      <div>
        <p className="eyebrow">Preparing Briefing</p>
        <h2>{activeTask.label}</h2>
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
      {activeTask.kind === "analyze" && (
        <button className="quiet-danger" disabled={stopDisabled} onClick={onStop} type="button">
          <StopCircle size={16} />
          Stop analysis
        </button>
      )}
    </section>
  );
}
