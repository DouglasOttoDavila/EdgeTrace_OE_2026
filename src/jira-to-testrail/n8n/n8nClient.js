const { DEFAULTS } = require("../types");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAbortError = (error) => {
  if (!error) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /abort|timed?\s*out/i.test(message);
};

const toErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const isRetryableHttpStatus = (status) => status >= 500 || status === 429;

const isRetryableError = (error) => {
  if (!error) {
    return false;
  }
  if (isAbortError(error)) {
    return false;
  }

  const message = toErrorMessage(error).toLowerCase();

  if (message.includes("unsupported") || message.includes("responded with status 4")) {
    return false;
  }

  if (message.includes("network") || message.includes("fetch") || message.includes("ecconn") || message.includes("enotfound")) {
    return true;
  }

  return false;
};

const countPayloadItems = (data) => {
  if (Array.isArray(data)) {
    return data.length;
  }
  if (!data || typeof data !== "object") {
    return 0;
  }
  if (Array.isArray(data.output)) {
    return data.output.length;
  }
  if (Array.isArray(data.items)) {
    return data.items.length;
  }
  if (Array.isArray(data.data)) {
    return data.data.length;
  }
  if (Array.isArray(data.results)) {
    return data.results.length;
  }
  if (typeof data.title === "string") {
    return 1;
  }
  return 0;
};

const toSupportedPayload = (data) => {
  if (Array.isArray(data)) {
    return data;
  }

  if (typeof data === "string") {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  if (typeof data.output === "string") {
    return data;
  }

  if (Array.isArray(data.output)) {
    return data.output;
  }

  if (data.output && typeof data.output === "object") {
    return [data.output];
  }

  const arrayKeys = ["items", "data", "results", "test_cases", "testCases", "cases"];
  for (const key of arrayKeys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  if (typeof data.title === "string" && Array.isArray(data.steps)) {
    return [data];
  }

  return undefined;
};

const postAnalyzeJiraIssue = async (jiraId, options = {}) => {
  const url = options.n8nWebhookUrl || DEFAULTS.n8nWebhookUrl;
  const timeoutMs = options.timeoutMs || 120000;
  const retries = options.retries ?? 0;
  const logger = options.logger;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (logger) {
        logger.info({
          message: "Posting Jira ID to n8n",
          jiraId,
          attempt: attempt + 1
        });
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jira_id: jiraId }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`n8n responded with status ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const executionId =
        response.headers.get("x-n8n-execution-id") ||
        response.headers.get("x-execution-id") ||
        response.headers.get("x-workflow-execution-id") ||
        undefined;
      const raw = await response.text();
      let data = raw;

      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(raw);
        } catch (parseError) {
          data = raw;
        }
      }

      const supported = toSupportedPayload(data);
      if (supported !== undefined) {
        if (logger) {
          logger.info({
            message: "n8n response received",
            attempt: attempt + 1,
            status: response.status,
            contentType,
            executionId,
            payloadItemCount: countPayloadItems(data),
            supportedItemCount: countPayloadItems(supported)
          });
        }
        return supported;
      }

      if (logger) {
        logger.warn({
          message: "Unsupported n8n payload shape",
          contentType,
          payloadType: Array.isArray(data) ? "array" : typeof data,
          objectKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 12) : []
        });
      }

      throw new Error("n8n response is unsupported; expected text or JSON array");
    } catch (error) {
      lastError = error;
      const message = toErrorMessage(error);
      const retryable =
        message.includes("n8n responded with status")
          ? isRetryableHttpStatus(Number((message.match(/status\s+(\d{3})/) || [])[1]))
          : isRetryableError(error);

      if (logger) {
        logger.warn({
          message: "n8n request failed",
          attempt: attempt + 1,
          retryable,
          error: message
        });
      }

      if (!retryable) {
        break;
      }

      if (attempt < retries) {
        const backoff = 500 * Math.pow(2, attempt);
        await sleep(backoff);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("n8n request failed");
};

module.exports = {
  postAnalyzeJiraIssue
};
