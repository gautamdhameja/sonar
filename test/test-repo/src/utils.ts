import { inspect } from "util";

/**
 * Format a number with thousand separators.
 * @param n - The number to format
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function validateInput(value: unknown): boolean {
  if (typeof value !== "number") return false;
  if (Number.isNaN(value)) return false;
  return Number.isFinite(value);
}

const debugLog = (msg: string): void => {
  const formatted = inspect(msg);
  console.log(`[DEBUG] ${formatted}`);
};

export { debugLog };
