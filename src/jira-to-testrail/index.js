const path = require("path");
const fs = require("fs/promises");
const { DEFAULTS } = require("./types");
const { postAnalyzeJiraIssue } = require("./n8n/n8nClient");

const createLogger = () => {
  const log = (level, payload) => {
    const entry = {
      level,
      timestamp: new Date().toISOString(),
      ...payload
    };
    const writer = level === "error" ? console.error : console.log;
    writer(JSON.stringify(entry));
  };

  return {
    info: (payload) => log("info", payload),
    warn: (payload) => log("warn", payload),
    error: (payload) => log("error", payload)
  };
};

const normalizeN8nOutput = (output) => {
  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output)) {
    const hasStructuredObjects = output.some(
      (item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.output !== "string"
    );

    if (hasStructuredObjects) {
      return JSON.stringify(output, null, 2);
    }

    const parts = output.map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item.output === "string") {
        return item.output;
      }
      return "";
    }).filter(Boolean);

    return parts.join("\n\n---\n\n");
  }

  if (output && typeof output.output === "string") {
    return output.output;
  }

  if (output && typeof output === "object") {
    return JSON.stringify(output, null, 2);
  }

  return "";
};

const writeN8nResponseFile = async (outputDir, jiraId, content) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(outputDir, jiraId, timestamp);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "response.txt");
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
};

const runJiraToTestrail = async (options) => {
  const logger = options.logger || createLogger();
  const jiraId = options.jiraId;
  const n8nWebhookUrl = options.n8nWebhookUrl || process.env.N8N_WEBHOOK_URL || DEFAULTS.n8nWebhookUrl;
  const outputDir = options.outputDir || process.env.N8N_OUTPUT_DIR || "data/n8n";
  const timeoutMs =
    options.timeoutMs ??
    (process.env.N8N_TIMEOUT_MS ? Number(process.env.N8N_TIMEOUT_MS) : undefined);
  const retries =
    options.retries ??
    (process.env.N8N_RETRIES ? Number(process.env.N8N_RETRIES) : undefined);

  const n8nOutput = await postAnalyzeJiraIssue(jiraId, {
    n8nWebhookUrl,
    timeoutMs,
    retries,
    logger
  });

  const normalized = normalizeN8nOutput(n8nOutput);
  if (!normalized.trim()) {
    throw new Error("n8n response was empty");
  }

  const filePath = await writeN8nResponseFile(outputDir, jiraId, normalized);
  logger.info({
    message: "Saved n8n response",
    jiraId,
    filePath,
    length: normalized.length
  });

  return { filePath, length: normalized.length };
};

module.exports = {
  runJiraToTestrail,
  createLogger
};
