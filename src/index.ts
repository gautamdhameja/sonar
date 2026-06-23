import { startServer } from "./api/server";
import { CONFIG } from "./config";
import { logger } from "./utils/logger";

async function main() {
  const args = process.argv.slice(2);
  let port = 3001;
  let repoRoot: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === "--repo" && args[i + 1]) {
      repoRoot = args[i + 1];
      i++;
    }
  }

  const running = await startServer(port);

  const shutdown = async () => {
    try {
      await running.close();
      logger.info("Sonar API server stopped");
    } catch (err) {
      logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  if (repoRoot) {
    logger.info(`Auto-indexing repository: ${repoRoot}`);
    const response = await fetch(`http://localhost:${port}/projects/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.security.apiToken ? { "X-Sonar-Token": CONFIG.security.apiToken } : {}),
      },
      body: JSON.stringify({ repoRoot }),
    });
    const result = (await response.json()) as {
      success?: boolean;
      projectId?: string;
      unitCount?: number;
      timeSeconds?: number;
      error?: string;
    };
    if (result.success) {
      logger.info(`Repository indexed: ${result.unitCount} code units in ${result.timeSeconds}s`);
    } else {
      logger.error(`Indexing failed: ${result.error}`);
    }
  }
}

main().catch((err) => logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err)));
