import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface ToastProps {
  children: ReactNode;
  tone?: "error" | "notice";
}

export function Toast({ children, tone = "error" }: ToastProps) {
  return (
    <div
      aria-live={tone === "notice" ? "polite" : "assertive"}
      className={tone === "notice" ? "toast-alert notice" : "toast-alert"}
      role={tone === "notice" ? "status" : "alert"}
    >
      {tone === "notice" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{children}</span>
    </div>
  );
}
