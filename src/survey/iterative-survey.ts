import fs from "fs/promises";
import path from "path";
import {
  buildFileObservationPrompt,
  buildGraphConsolidationPrompt,
  buildGraphValidationPrompt,
  buildSurveyPlanningPrompt,
  SurveyFileExcerpt,
} from "../generator/repository-survey-prompt";
import { generateStructuredJson, StructuredCompletion, StructuredValidation } from "../generator/structured-llm";
import { CONFIG } from "../config";
import { throwIfAborted } from "../utils/abort";
import { selectSurveyFiles, SurveyPlanFileRequest } from "./file-selection";
import { compactMemoryGraph, emptyMemoryGraph, MemoryGraph, MemoryGraphEdge, MemoryGraphNode } from "./memory-graph";
import { validateMemoryGraph } from "./memory-graph-validator";
import { buildRepositoryInventory, InventoryFile, RepositoryInventory } from "./repository-inventory";
import { DEFAULT_SURVEY_BUDGET, normalizeSurveyBudget, SurveyBudget } from "./survey-budget";

export interface RepositorySurveyOptions {
  repoRoot: string;
  projectId: string;
  repoName: string;
  budget?: Partial<SurveyBudget>;
  signal?: AbortSignal;
  complete?: StructuredCompletion;
}

export interface RepositorySurveyResult {
  inventory: RepositoryInventory;
  graph: MemoryGraph;
  iterations: number;
  inspectedFiles: string[];
  warnings: string[];
  fallbackUsed: boolean;
}

interface SurveyPlanResponse {
  files: SurveyPlanFileRequest[];
  questions: string[];
  warnings: string[];
}

interface SurveyObservationResponse {
  summary: string;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  inspectedFiles: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function validateSurveyPlan(value: unknown): StructuredValidation<SurveyPlanResponse> {
  if (!isRecord(value)) return { valid: false, value: null, errors: ["plan must be an object"] };
  if (!Array.isArray(value.files)) return { valid: false, value: null, errors: ["files must be an array"] };

  const files = value.files
    .filter(isRecord)
    .map((file) => ({
      filePath: typeof file.filePath === "string" ? file.filePath.trim() : "",
      reason: typeof file.reason === "string" ? file.reason.trim() : undefined,
      priority: typeof file.priority === "number" && Number.isFinite(file.priority) ? file.priority : 0,
    }))
    .filter((file) => file.filePath.length > 0);

  if (files.length === 0) return { valid: false, value: null, errors: ["plan must include at least one file"] };
  return {
    valid: true,
    value: {
      files,
      questions: stringArray(value.questions),
      warnings: stringArray(value.warnings),
    },
    errors: [],
  };
}

function validateSurveyObservation(value: unknown): StructuredValidation<SurveyObservationResponse> {
  if (!isRecord(value)) return { valid: false, value: null, errors: ["observation must be an object"] };
  const summary =
    typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : "Inspection completed.";
  const nodes = Array.isArray(value.nodes) ? (value.nodes as MemoryGraphNode[]) : [];
  const edges = Array.isArray(value.edges) ? (value.edges as MemoryGraphEdge[]) : [];
  if (nodes.length === 0) return { valid: false, value: null, errors: ["observation must include graph nodes"] };
  return {
    valid: true,
    value: {
      summary,
      nodes,
      edges,
      inspectedFiles: stringArray(value.inspectedFiles),
      warnings: stringArray(value.warnings),
    },
    errors: [],
  };
}

function graphSourceFiles(graph: MemoryGraph): Set<string> {
  return new Set([
    ...graph.nodes.flatMap((node) => node.sources.map((source) => source.filePath)),
    ...graph.edges.flatMap((edge) => edge.sources.map((source) => source.filePath)),
  ]);
}

function candidateWith(
  graph: MemoryGraph,
  summary: string,
  nodes: MemoryGraphNode[],
  edges: MemoryGraphEdge[],
  inspectedFiles: string[],
  warnings: string[],
): MemoryGraph {
  return {
    projectId: graph.projectId,
    generatedAt: new Date().toISOString(),
    summary,
    nodes,
    edges,
    inspectedFiles,
    warnings,
  };
}

function mergeGraph(
  graph: MemoryGraph,
  observation: SurveyObservationResponse,
  inspectedFiles: string[],
): { graph: MemoryGraph; warnings: string[] } {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  for (const node of observation.nodes) nodes.set(node.id, node);
  for (const edge of observation.edges) edges.set(edge.id, edge);

  const mergedInspectedFiles = [
    ...new Set([...graph.inspectedFiles, ...inspectedFiles, ...observation.inspectedFiles]),
  ];
  const mergedWarnings = [...new Set([...graph.warnings, ...observation.warnings])];
  const mergedSummary = observation.summary || graph.summary;
  const candidate = candidateWith(
    graph,
    mergedSummary,
    [...nodes.values()],
    [...edges.values()],
    mergedInspectedFiles,
    mergedWarnings,
  );
  const validation = validateMemoryGraph(candidate);
  if (validation.valid && validation.graph) return { graph: validation.graph, warnings: [] };

  let salvaged = candidateWith(graph, mergedSummary, graph.nodes, graph.edges, mergedInspectedFiles, mergedWarnings);
  const warnings = validation.errors.map((error) => `Rejected full graph update: ${error}`);

  for (const node of observation.nodes) {
    const nextNodes = new Map(salvaged.nodes.map((existingNode) => [existingNode.id, existingNode]));
    nextNodes.set(node.id, node);
    const nextNodeIds = new Set(nextNodes.keys());
    const nextEdges = salvaged.edges.filter((edge) => nextNodeIds.has(edge.from) && nextNodeIds.has(edge.to));
    const nodeCandidate = candidateWith(
      graph,
      mergedSummary,
      [...nextNodes.values()],
      nextEdges,
      mergedInspectedFiles,
      mergedWarnings,
    );
    const nodeValidation = validateMemoryGraph(nodeCandidate);
    if (nodeValidation.valid && nodeValidation.graph) {
      salvaged = nodeValidation.graph;
    } else {
      warnings.push(`Rejected graph node ${node.id || "(unknown)"}: ${nodeValidation.errors.join("; ")}`);
    }
  }

  for (const edge of observation.edges) {
    const nextEdges = new Map(salvaged.edges.map((existingEdge) => [existingEdge.id, existingEdge]));
    nextEdges.set(edge.id, edge);
    const edgeCandidate = candidateWith(
      graph,
      mergedSummary,
      salvaged.nodes,
      [...nextEdges.values()],
      mergedInspectedFiles,
      mergedWarnings,
    );
    const edgeValidation = validateMemoryGraph(edgeCandidate);
    if (edgeValidation.valid && edgeValidation.graph) {
      salvaged = edgeValidation.graph;
    } else {
      warnings.push(`Rejected graph edge ${edge.id || "(unknown)"}: ${edgeValidation.errors.join("; ")}`);
    }
  }

  return { graph: { ...salvaged, warnings: [...new Set([...salvaged.warnings, ...warnings])] }, warnings };
}

async function readExcerpt(
  repoRoot: string,
  file: InventoryFile,
  budget: SurveyBudget,
): Promise<SurveyFileExcerpt | null> {
  const fullPath = path.join(repoRoot, file.filePath);
  const text = await fs.readFile(fullPath, "utf-8");
  const allLines = text.split(/\r?\n/);
  const lines = allLines.slice(0, budget.maxExcerptLines);
  const signals: string[] = file.signals.map((signal) => signal.kind);
  if (file.bytes > budget.maxFileBytes || allLines.length > budget.maxExcerptLines) {
    signals.push("excerpt_truncated");
  }
  return {
    filePath: file.filePath,
    language: file.language,
    startLine: 1,
    endLine: Math.max(1, lines.length),
    text: lines.join("\n"),
    signals,
  };
}

async function consolidateGraph(
  graph: MemoryGraph,
  inventory: RepositoryInventory,
  options: Pick<RepositorySurveyOptions, "repoName" | "complete" | "signal">,
): Promise<MemoryGraph> {
  if (graph.nodes.length === 0) return graph;
  if (!options.complete && shouldUseDeterministicConsolidation()) return compactMemoryGraph(graph);

  const prompt = buildGraphConsolidationPrompt({ repoName: options.repoName, inventory, graph });
  const result = await generateStructuredJson<MemoryGraph>({
    ...prompt,
    complete: options.complete,
    maxRepairAttempts: 0,
    label: `survey-consolidate ${options.repoName}`,
    signal: options.signal,
    validate: (value) => {
      const validation = validateMemoryGraph(value);
      return { valid: validation.valid, value: validation.graph, errors: validation.errors };
    },
  });
  if (result.ok) return compactMemoryGraph(result.value);

  return compactMemoryGraph({
    ...graph,
    warnings: [
      ...graph.warnings,
      `LLM graph consolidation failed; used deterministic graph compaction: ${result.errors.join("; ")}`,
    ],
  });
}

function selectGraphValidationFiles(
  inventory: RepositoryInventory,
  graph: MemoryGraph,
  budget: Pick<SurveyBudget, "maxValidationFiles">,
): InventoryFile[] {
  const byPath = new Map(inventory.files.map((file) => [file.filePath, file]));
  const cited = graphSourceFiles(graph);
  const selected: InventoryFile[] = [];
  const selectedPaths = new Set<string>();

  function add(file: InventoryFile | undefined): void {
    if (!file || selected.length >= budget.maxValidationFiles) return;
    if (selectedPaths.has(file.filePath) || file.vendored) return;
    selected.push(file);
    selectedPaths.add(file.filePath);
  }

  for (const filePath of graph.inspectedFiles) {
    if (!cited.has(filePath)) add(byPath.get(filePath));
  }

  const inspected = new Set(graph.inspectedFiles);
  for (const file of inventory.candidateFiles) {
    if (selected.length >= budget.maxValidationFiles) break;
    if (inspected.has(file.filePath)) continue;
    add(file);
  }

  for (const file of inventory.documentationSources) {
    if (selected.length >= budget.maxValidationFiles) break;
    if (inspected.has(file.filePath) && cited.has(file.filePath)) continue;
    add(file);
  }

  return selected;
}

async function validateGraphPass(
  graph: MemoryGraph,
  inventory: RepositoryInventory,
  options: Pick<RepositorySurveyOptions, "repoRoot" | "repoName" | "complete" | "signal"> & { budget: SurveyBudget },
): Promise<{ graph: MemoryGraph; warnings: string[]; fallbackUsed: boolean }> {
  const selection = selectGraphValidationFiles(inventory, graph, options.budget);
  if (selection.length === 0) return { graph, warnings: [], fallbackUsed: false };

  const excerpts = (
    await Promise.all(selection.map((file) => readExcerpt(options.repoRoot, file, options.budget)))
  ).filter((excerpt): excerpt is SurveyFileExcerpt => excerpt !== null);
  if (excerpts.length === 0) return { graph, warnings: [], fallbackUsed: false };

  throwIfAborted(options.signal);
  const validationPrompt = buildGraphValidationPrompt({
    repoName: options.repoName,
    inventory,
    graph,
    files: excerpts,
  });
  const validationResult = await generateStructuredJson<SurveyObservationResponse>({
    ...validationPrompt,
    complete: options.complete,
    maxRepairAttempts: 1,
    label: `survey-validate ${options.repoName}`,
    signal: options.signal,
    validate: validateSurveyObservation,
  });

  const selectedPaths = excerpts.map((excerpt) => excerpt.filePath);
  if (!validationResult.ok) {
    const validationWarnings = validationResult.errors.map((error) => `Graph validation skipped: ${error}`);
    return {
      graph: {
        ...graph,
        inspectedFiles: [...new Set([...graph.inspectedFiles, ...selectedPaths])],
        warnings: [...new Set([...graph.warnings, ...validationWarnings])],
      },
      warnings: validationWarnings,
      fallbackUsed: graph.nodes.length === 0,
    };
  }

  const merged = mergeGraph(graph, validationResult.value, selectedPaths);
  return { graph: merged.graph, warnings: merged.warnings, fallbackUsed: false };
}

function shouldUseDeterministicConsolidation(): boolean {
  try {
    const hostname = new URL(CONFIG.chat.baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

export async function runIterativeRepositorySurvey(options: RepositorySurveyOptions): Promise<RepositorySurveyResult> {
  const budget = normalizeSurveyBudget(options.budget ?? DEFAULT_SURVEY_BUDGET);
  const inventory = await buildRepositoryInventory(options.repoRoot, options.signal);
  let graph = emptyMemoryGraph(options.projectId);
  graph = {
    ...graph,
    summary: `Repository survey for ${options.repoName} started from deterministic inventory.`,
  };
  const warnings: string[] = [];
  let fallbackUsed = false;
  let iterations = 0;

  for (let iteration = 0; iteration < budget.maxIterations; iteration += 1) {
    throwIfAborted(options.signal);
    if (graph.inspectedFiles.length >= budget.maxFilesTotal) break;
    iterations += 1;

    const planPrompt = buildSurveyPlanningPrompt({ repoName: options.repoName, inventory, graph });
    const planResult = await generateStructuredJson<SurveyPlanResponse>({
      ...planPrompt,
      complete: options.complete,
      maxRepairAttempts: 1,
      label: `survey-plan ${options.repoName} iteration ${iteration + 1}`,
      signal: options.signal,
      validate: validateSurveyPlan,
    });
    const requestedFiles = planResult.ok ? planResult.value.files : [];
    if (!planResult.ok) {
      fallbackUsed = true;
      warnings.push(...planResult.errors.map((error) => `Survey planning fallback: ${error}`));
    }

    const selection = selectSurveyFiles(inventory, graph, requestedFiles, budget);
    if (selection.rejected.length > 0) {
      warnings.push(...selection.rejected.slice(0, 10).map((item) => `Skipped ${item.filePath}: ${item.reason}`));
    }
    if (selection.selected.length === 0) break;
    if (!planResult.ok || requestedFiles.length === 0) fallbackUsed = true;

    const excerpts = (
      await Promise.all(selection.selected.map((file) => readExcerpt(options.repoRoot, file, budget)))
    ).filter((excerpt): excerpt is SurveyFileExcerpt => excerpt !== null);
    const selectedPaths = excerpts.map((excerpt) => excerpt.filePath);
    if (excerpts.length === 0) break;

    throwIfAborted(options.signal);
    const observationPrompt = buildFileObservationPrompt({
      repoName: options.repoName,
      inventory,
      graph,
      files: excerpts,
    });
    const observationResult = await generateStructuredJson<SurveyObservationResponse>({
      ...observationPrompt,
      complete: options.complete,
      maxRepairAttempts: 1,
      label: `survey-observe ${options.repoName} iteration ${iteration + 1}`,
      signal: options.signal,
      validate: validateSurveyObservation,
    });
    if (!observationResult.ok) {
      fallbackUsed = true;
      warnings.push(...observationResult.errors.map((error) => `Survey observation skipped: ${error}`));
      graph = {
        ...graph,
        inspectedFiles: [...new Set([...graph.inspectedFiles, ...selectedPaths])],
        warnings: [...new Set([...graph.warnings, ...observationResult.errors])],
      };
      continue;
    }

    const merged = mergeGraph(graph, observationResult.value, selectedPaths);
    graph = merged.graph;
    warnings.push(...merged.warnings.map((error) => `Rejected survey graph update: ${error}`));
  }

  for (let validationPass = 0; validationPass < budget.validationPasses; validationPass += 1) {
    throwIfAborted(options.signal);
    const validation = await validateGraphPass(graph, inventory, { ...options, budget });
    graph = validation.graph;
    fallbackUsed = fallbackUsed || validation.fallbackUsed;
    warnings.push(...validation.warnings.map((warning) => `Graph validation pass: ${warning}`));
  }

  graph = await consolidateGraph(graph, inventory, {
    repoName: options.repoName,
    complete: options.complete,
    signal: options.signal,
  });
  graph = {
    ...graph,
    warnings: [...new Set([...graph.warnings, ...warnings])],
  };
  return {
    inventory,
    graph,
    iterations,
    inspectedFiles: graph.inspectedFiles,
    warnings: graph.warnings,
    fallbackUsed,
  };
}
