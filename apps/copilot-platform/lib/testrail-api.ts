type TestrailCase = {
  id: number;
  title: string;
  refs?: string;
  custom_steps_separated?: Array<{
    content?: string;
    expected?: string;
    additional_info?: string;
  }>;
  [key: string]: unknown;
};

const requiredEnv = ["TESTRAIL_BASE_URL", "TESTRAIL_USER", "TESTRAIL_API_KEY"] as const;

const missingRequiredEnv = () => {
  return requiredEnv.filter((key) => !process.env[key] || String(process.env[key]).trim().length === 0);
};

const buildAuthHeader = () => {
  const user = process.env.TESTRAIL_USER || "";
  const apiKey = process.env.TESTRAIL_API_KEY || "";
  return `Basic ${Buffer.from(`${user}:${apiKey}`).toString("base64")}`;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

const normalizeCaseId = (value: string | number): number => {
  if (typeof value === "number") {
    return value;
  }

  const cleaned = String(value).trim().toUpperCase();
  const numeric = cleaned.startsWith("C") ? cleaned.slice(1) : cleaned;
  const parsed = Number(numeric);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid TestRail case id: ${value}`);
  }

  return parsed;
};

export const getCaseFromTestrail = async (caseId: string | number): Promise<TestrailCase> => {
  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    throw new Error(`Missing TestRail env: ${missing.join(", ")}`);
  }

  const normalizedCaseId = normalizeCaseId(caseId);
  const baseUrl = normalizeBaseUrl(process.env.TESTRAIL_BASE_URL || "");
  const endpoint = `${baseUrl}/index.php?/api/v2/get_case/${normalizedCaseId}`;

  console.log(
    JSON.stringify({
      level: "info",
      scope: "testrail-api",
      action: "get_case",
      endpoint,
      caseId: normalizedCaseId
    })
  );

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: buildAuthHeader(),
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  console.log(
    JSON.stringify({
      level: "info",
      scope: "testrail-api",
      action: "get_case_response",
      endpoint,
      caseId: normalizedCaseId,
      status: response.status,
      ok: response.ok
    })
  );

  if (!response.ok) {
    throw new Error(`TestRail get_case failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const parsed = JSON.parse(text) as TestrailCase;
  if (!parsed.id) {
    throw new Error("TestRail get_case returned invalid payload");
  }

  return parsed;
};

