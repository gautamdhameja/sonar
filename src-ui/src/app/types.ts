export type RepositorySource = "github" | "local";
export type ActiveTaskKind = "bootstrap" | "settings" | "analyze" | "brief" | "followup";

export interface ActiveTask {
  kind: ActiveTaskKind;
  label: string;
}
