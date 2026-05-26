export interface ScoredResult {
  unitId: string;
  score: number;
  source: "keyword" | "semantic";
  isVendored: boolean;
}
