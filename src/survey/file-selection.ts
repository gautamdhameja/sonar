import path from "path";
import { InventoryFile, RepositoryInventory } from "./repository-inventory";
import { MemoryGraph } from "./memory-graph";
import { SurveyBudget } from "./survey-budget";

export interface SurveyPlanFileRequest {
  filePath: string;
  reason?: string;
  priority?: number;
}

export interface SurveyFileSelection {
  selected: InventoryFile[];
  rejected: Array<{ filePath: string; reason: string }>;
}

function directoryGroup(filePath: string): string {
  const directory = path.dirname(filePath.replace(/\\/g, "/"));
  if (directory === ".") return "<root>";
  return directory.split("/").slice(0, 2).join("/");
}

function selectionSort(a: InventoryFile, b: InventoryFile): number {
  return b.entryScore - a.entryScore || a.filePath.localeCompare(b.filePath);
}

function knownInventoryFiles(inventory: RepositoryInventory): Map<string, InventoryFile> {
  return new Map(inventory.files.map((file) => [file.filePath, file]));
}

export function selectSurveyFiles(
  inventory: RepositoryInventory,
  graph: MemoryGraph,
  requests: SurveyPlanFileRequest[],
  budget: Pick<SurveyBudget, "maxFilesPerIteration" | "maxFilesTotal" | "maxFileBytes">,
): SurveyFileSelection {
  const byPath = knownInventoryFiles(inventory);
  const inspected = new Set(graph.inspectedFiles);
  const selected: InventoryFile[] = [];
  const selectedPaths = new Set<string>();
  const rejected: Array<{ filePath: string; reason: string }> = [];
  const remainingTotal = Math.max(0, budget.maxFilesTotal - inspected.size);
  const limit = Math.min(budget.maxFilesPerIteration, remainingTotal);
  const firstPass = inspected.size === 0;

  function canSelect(file: InventoryFile): string | null {
    if (selectedPaths.has(file.filePath) || inspected.has(file.filePath)) return "already inspected";
    if (file.vendored) return "vendored or third-party path";
    return null;
  }

  function add(file: InventoryFile): boolean {
    const reason = canSelect(file);
    if (reason) {
      rejected.push({ filePath: file.filePath, reason });
      return false;
    }
    selected.push(file);
    selectedPaths.add(file.filePath);
    return true;
  }

  function selectedDocumentationFileCount(): number {
    return selected.filter((file) => file.documentation).length;
  }

  const sortedRequests = [...requests].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.filePath.localeCompare(b.filePath),
  );
  for (const request of sortedRequests) {
    if (selected.length >= limit) break;
    const file = byPath.get(request.filePath);
    if (!file) {
      rejected.push({ filePath: request.filePath, reason: "not found in deterministic inventory" });
      continue;
    }
    add(file);
  }

  if (firstPass) {
    const documentationLimit = Math.min(2, Math.max(0, limit - selected.length - 1));
    for (const file of inventory.documentationSources) {
      if (selectedDocumentationFileCount() >= documentationLimit) break;
      if (selectedPaths.has(file.filePath)) continue;
      add(file);
    }
  }

  const groupCounts = new Map<string, number>();
  for (const file of selected)
    groupCounts.set(directoryGroup(file.filePath), (groupCounts.get(directoryGroup(file.filePath)) ?? 0) + 1);

  const candidates = inventory.candidateFiles.filter((file) => !selectedPaths.has(file.filePath)).sort(selectionSort);
  for (const file of candidates) {
    if (selected.length >= limit) break;
    if (firstPass && file.documentation && selectedDocumentationFileCount() >= 2) continue;
    const group = directoryGroup(file.filePath);
    if ((groupCounts.get(group) ?? 0) >= 2) continue;
    if (add(file)) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  for (const file of candidates) {
    if (selected.length >= limit) break;
    if (firstPass && file.documentation && selectedDocumentationFileCount() >= 2) continue;
    add(file);
  }

  return { selected, rejected };
}
