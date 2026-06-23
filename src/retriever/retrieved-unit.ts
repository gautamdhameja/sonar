export interface RetrievedUnit {
  unitId: string;
  rrfScore: number;
  keywordRank: number | null;
  semanticRank: number | null;
  isVendored: boolean;
}
