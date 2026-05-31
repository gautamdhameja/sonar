import { CONFIG } from "../config";
import { ScoredResult } from "./types";
import { logger } from "../utils/logger";
import { throwIfAborted, withTimeout } from "../utils/abort";

function baseUrl(): string {
  return `http://${CONFIG.qdrant.host}:${CONFIG.qdrant.port}`;
}

async function qdrantFetch<T>(path: string, init?: RequestInit, allowNotFound = false): Promise<T> {
  const response = await withTimeout(init?.signal ?? undefined, 30_000, (signal) =>
    fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal,
    }),
  );

  if (allowNotFound && response.status === 404) {
    return undefined as T;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Qdrant request failed (${response.status}) ${path}: ${body.slice(0, 500)}`);
  }

  return response.json() as Promise<T>;
}

function getCollectionName(projectId: string): string {
  return `code-embeddings-${projectId}`;
}

export async function deleteQdrantCollection(projectId: string, signal?: AbortSignal): Promise<void> {
  await qdrantFetch(`/collections/${getCollectionName(projectId)}`, { method: "DELETE", signal }, true);
}

export async function indexToQdrant(
  units: { unitId: string; name: string; filePath: string; kind: string; isVendored: boolean }[],
  embeddings: number[][],
  projectId: string,
  signal?: AbortSignal,
): Promise<void> {
  const collectionName = getCollectionName(projectId);

  throwIfAborted(signal);
  await deleteQdrantCollection(projectId, signal);

  await qdrantFetch(`/collections/${collectionName}`, {
    method: "PUT",
    signal,
    body: JSON.stringify({
      vectors: { size: CONFIG.qdrant.vectorSize, distance: "Cosine" },
    }),
  });

  const batchSize = 100;
  for (let i = 0; i < units.length; i += batchSize) {
    throwIfAborted(signal);
    const batchUnits = units.slice(i, i + batchSize);
    const batchEmbeddings = embeddings.slice(i, i + batchSize);

    await qdrantFetch(`/collections/${collectionName}/points?wait=true`, {
      method: "PUT",
      signal,
      body: JSON.stringify({
        points: batchUnits.map((unit, j) => ({
          id: i + j,
          vector: batchEmbeddings[j],
          payload: {
            unitId: unit.unitId,
            name: unit.name,
            filePath: unit.filePath,
            kind: unit.kind,
            isVendored: unit.isVendored,
          },
        })),
      }),
    });
  }

  logger.info(`Indexed ${units.length} embeddings to Qdrant`);
}

export async function searchQdrant(queryEmbedding: number[], topK: number, projectId: string): Promise<ScoredResult[]> {
  const response = await qdrantFetch<{
    result: Array<{ score: number; payload?: Record<string, unknown> }>;
  }>(`/collections/${getCollectionName(projectId)}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector: queryEmbedding,
      limit: topK,
      with_payload: true,
    }),
  });

  return response.result.map((point) => ({
    unitId: (point.payload?.unitId as string) ?? "",
    score: point.score,
    source: "semantic" as const,
    isVendored: (point.payload?.isVendored as boolean) ?? false,
  }));
}
