import { MeiliSearch } from "meilisearch";
import { CONFIG } from "../config";
import { CodeUnit } from "../parser/types";
import { ScoredResult } from "./types";
import { enrichUnitsForKeywordIndex } from "./contextual-text";
import { logger } from "../utils/logger";
import { throwIfAborted } from "../utils/abort";

export const MEILI_CODE_SEARCH_SETTINGS = {
  searchableAttributes: [
    "name",
    "filePath",
    "exportedNames",
    "imports",
    "calledFunctions",
    "docstring",
    "kind",
    "contextualText",
    "code",
  ],
  filterableAttributes: ["language", "kind", "filePath", "isVendored"],
  rankingRules: ["words", "exactness", "attribute", "proximity", "typo", "sort"],
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 8,
      twoTypos: 14,
    },
    disableOnAttributes: ["name", "filePath", "exportedNames", "imports", "calledFunctions"],
  },
} as const;

function createClient(): MeiliSearch {
  const apiKey = CONFIG.meilisearch.apiKey.trim();
  return new MeiliSearch({
    host: CONFIG.meilisearch.host,
    ...(apiKey ? { apiKey } : {}),
  });
}

function getIndexName(projectId: string): string {
  return `code-units-${projectId}`;
}

export async function indexToMeilisearch(units: CodeUnit[], projectId: string, signal?: AbortSignal): Promise<void> {
  const client = createClient();
  const indexName = getIndexName(projectId);

  throwIfAborted(signal);
  await client.deleteIndexIfExists(indexName);

  throwIfAborted(signal);
  const createTask = await client.createIndex(indexName, { primaryKey: "id" });
  await client.waitForTask(createTask.taskUid);

  const index = client.index(indexName);

  throwIfAborted(signal);
  const searchableTask = await index.updateSearchableAttributes([...MEILI_CODE_SEARCH_SETTINGS.searchableAttributes]);
  await index.waitForTask(searchableTask.taskUid);

  throwIfAborted(signal);
  const rankingTask = await index.updateRankingRules([...MEILI_CODE_SEARCH_SETTINGS.rankingRules]);
  await index.waitForTask(rankingTask.taskUid);

  throwIfAborted(signal);
  const typoTask = await index.updateTypoTolerance({
    ...MEILI_CODE_SEARCH_SETTINGS.typoTolerance,
    disableOnAttributes: [...MEILI_CODE_SEARCH_SETTINGS.typoTolerance.disableOnAttributes],
  });
  await index.waitForTask(typoTask.taskUid);

  throwIfAborted(signal);
  const filterableTask = await index.updateFilterableAttributes([...MEILI_CODE_SEARCH_SETTINGS.filterableAttributes]);
  await index.waitForTask(filterableTask.taskUid);

  throwIfAborted(signal);
  const addTask = await index.addDocuments(enrichUnitsForKeywordIndex(units));
  await index.waitForTask(addTask.taskUid);

  logger.info(`Indexed ${units.length} code units to Meilisearch`);
}

export async function deleteMeilisearchIndex(projectId: string): Promise<void> {
  const client = createClient();
  await client.deleteIndexIfExists(getIndexName(projectId));
}

export async function searchMeilisearch(query: string, topK: number, projectId: string): Promise<ScoredResult[]> {
  const client = createClient();
  const index = client.index(getIndexName(projectId));

  const results = await index.search(query, {
    limit: topK,
    attributesToSearchOn: [...MEILI_CODE_SEARCH_SETTINGS.searchableAttributes],
    attributesToCrop: ["code"],
    cropLength: 24,
    showMatchesPosition: true,
  });

  return results.hits.map((hit, rank) => ({
    unitId: hit.id as string,
    score: 1 / (rank + 1),
    source: "keyword" as const,
    isVendored: (hit.isVendored as boolean) ?? false,
  }));
}
