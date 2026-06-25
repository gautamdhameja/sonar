import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { useDialog } from "../app/useDialog";

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  children: ReactNode;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  confirmLabel,
  children,
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useDialog<HTMLElement>(onCancel);

  return (
    <div className="drawer-backdrop setup-backdrop" role="presentation">
      <button aria-label="Cancel" className="drawer-scrim" onClick={onCancel} type="button" />
      <section
        aria-describedby="confirm-dialog-body"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="setup-dialog confirm-dialog"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div>
          <h2 id="confirm-dialog-title">{title}</h2>
          <div className="confirm-body" id="confirm-dialog-body">
            {children}
          </div>
        </div>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={tone === "danger" ? "quiet-danger" : "primary"} onClick={onConfirm} type="button">
            {tone === "danger" ? <AlertTriangle size={16} /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
