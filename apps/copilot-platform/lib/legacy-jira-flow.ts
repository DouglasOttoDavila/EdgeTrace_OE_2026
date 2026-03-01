import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

type LegacyRunResult = {
  filePath: string;
  length: number;
};

type LegacyLogger = {
  info: (payload: unknown) => void;
  warn: (payload: unknown) => void;
  error: (payload: unknown) => void;
};

const legacyModule = require("../../../src/jira-to-testrail/index.js") as {
  runJiraToTestrail: (options: {
    jiraId: string;
    logger: LegacyLogger;
    outputDir?: string;
    n8nWebhookUrl?: string;
    timeoutMs?: number;
    retries?: number;
  }) => Promise<LegacyRunResult>;
};

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const logger: LegacyLogger = {
  info: (payload) => console.log(JSON.stringify({ level: "info", scope: "legacy-bridge", payload })),
  warn: (payload) => console.warn(JSON.stringify({ level: "warn", scope: "legacy-bridge", payload })),
  error: (payload) => console.error(JSON.stringify({ level: "error", scope: "legacy-bridge", payload }))
};

export const runLegacyJiraFlow = async (jiraId: string): Promise<LegacyRunResult> => {
  return legacyModule.runJiraToTestrail({
    jiraId,
    logger,
    outputDir: path.join(workspaceRoot, "data", "n8n"),
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,
    timeoutMs: process.env.N8N_TIMEOUT_MS ? Number(process.env.N8N_TIMEOUT_MS) : undefined,
    retries: process.env.N8N_RETRIES ? Number(process.env.N8N_RETRIES) : undefined
  });
};