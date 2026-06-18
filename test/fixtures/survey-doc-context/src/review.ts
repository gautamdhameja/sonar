export function reviewTransactions(rows: string[]) {
  return rows.map((row) => ({ row, status: row.includes("blocked") ? "needs-review" : "accepted" }));
}
