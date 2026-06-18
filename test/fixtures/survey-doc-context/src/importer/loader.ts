/**
 * Loads transaction CSV files from disk and turns them into ledger rows.
 * This module-level comment is useful context when the README is sparse.
 */
import { readFileSync } from "node:fs";

export function loadTransactions(filePath: string) {
  return readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
}
