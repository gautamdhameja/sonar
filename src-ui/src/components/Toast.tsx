import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

interface ToastProps {
  children: ReactNode;
  onDismiss: () => void;
  tone?: "error" | "notice";
}

export function Toast({ children, onDismiss, tone = "error" }: ToastProps) {
  return (
    <div
      aria-live={tone === "notice" ? "polite" : "assertive"}
      className={tone === "notice" ? "toast-alert notice" : "toast-alert"}
      role={tone === "notice" ? "status" : "alert"}
    >
      {tone === "notice" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{children}</span>
      <button aria-label="Dismiss notification" className="toast-dismiss" onClick={onDismiss} type="button">
        <X size={16} />
      </button>
    </div>
  );
}
