import { useEffect, useRef } from "react";

export function useDialog<T extends HTMLElement>(onDismiss?: () => void) {
  const ref = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    ref.current?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissRef.current?.();
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, []);

  return ref;
}
