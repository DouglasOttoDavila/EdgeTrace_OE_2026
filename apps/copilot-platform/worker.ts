import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { claimNextQueuedJob } from "./lib/job-store";
import { processJob } from "./lib/job-processor";

const workerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workerDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const pollIntervalMs = Number(process.env.PLATFORM_WORKER_POLL_MS || 1500);

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const runWorker = async () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Platform worker started",
      pollIntervalMs,
      n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "<undefined>"
    })
  );

  while (true) {
    const job = claimNextQueuedJob();
    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      await processJob(job.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Worker failed processing job",
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};

void runWorker();