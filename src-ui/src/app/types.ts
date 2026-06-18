export type RepositorySource = "github" | "local";
export type BriefingRole = "product_strategy" | "engineering" | "go_to_market" | "customer_success" | "leadership";
export type ActiveTaskKind = "bootstrap" | "settings" | "analyze" | "brief" | "followup";

export interface ActiveTask {
  kind: ActiveTaskKind;
  label: string;
  progress?: number;
  detail?: string;
  canStop?: boolean;
}
