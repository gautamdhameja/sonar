import { CodeUnit } from "../parser/types";
import { logger } from "../utils/logger";
import { throwIfAborted } from "../utils/abort";

export async function indexRepository(units: CodeUnit[], projectId: string, signal?: AbortSignal): Promise<void> {
  const totalStart = Date.now();
  throwIfAborted(signal);

  logger.info(
    `Local repository index prepared for ${projectId}: ${units.length} code units in ${(
      (Date.now() - totalStart) / 1000
    ).toFixed(1)}s`,
  );
}

export async function deleteProjectIndexes(projectId: string): Promise<void> {
  logger.debug(`No external indexes to clean for project ${projectId}`);
}
