import { readFileSync, writeFileSync } from "node:fs";

type RecordRow = { email: string; plan: string; active: boolean };

export function importCustomers(inputPath: string, outputPath: string) {
  const rows = readFileSync(inputPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line): RecordRow => {
      const [email, plan, active] = line.split(",");
      return { email, plan, active: active === "true" };
    });

  const activePaid = rows.filter((row) => row.active && row.plan !== "free");
  writeFileSync(outputPath, JSON.stringify({ customers: activePaid }, null, 2));
  return activePaid.length;
}
