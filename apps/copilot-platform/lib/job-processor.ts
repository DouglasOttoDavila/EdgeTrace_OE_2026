import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { addJobEvent, getJob, patchJob, setJobStatus } from "./job-store";
import { runLegacyJiraFlow } from "./legacy-jira-flow";
import { runCopilotWorkflow } from "./copilot-orchestrator";
import { collectExecutionEvidence } from "./testrail-service";
import { getCaseFromTestrail } from "./testrail-api";
import type { AutomationTestResult, EvidenceArtifact, ExecutionMetrics, GeneratedTestCase, GeneratedTestStep } from "./types";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const persistCopilotResponse = async (
  jobId: string,
  workflowType: "generate_test_cases" | "generate_automation",
  content: string
): Promise<string> => {
  const outputDir = path.join(workspaceRoot, "data", "platform", "copilot");
  await mkdir(outputDir, { recursive: true });
  const absolutePath = path.join(outputDir, `${jobId}-${workflowType}.md`);
  await writeFile(absolutePath, content || "", "utf8");
  return path.relative(workspaceRoot, absolutePath).replaceAll("\\", "/");
};

const resolveWorkspaceSafePath = (relativePath: string): string | undefined => {
  const normalized = relativePath.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    return undefined;
  }

  const absolute = path.resolve(workspaceRoot, normalized);
  if (!absolute.startsWith(workspaceRoot)) {
    return undefined;
  }

  return absolute;
};

const persistAutomationArtifacts = async (
  jobId: string,
  evidence: EvidenceArtifact[]
): Promise<{ persistedEvidence: EvidenceArtifact[]; persistedCount: number }> => {
  const destinationRootRelative = path.join("data", "platform", "artifacts", jobId).replaceAll("\\", "/");
  const destinationRootAbsolute = path.join(workspaceRoot, destinationRootRelative);
  await mkdir(destinationRootAbsolute, { recursive: true });

  const persisted: EvidenceArtifact[] = [];
  let copiedReportDirectory = false;
  let persistedCount = 0;

  for (const item of evidence) {
    const sourceRelative = item.path.replaceAll("\\", "/");
    const sourceAbsolute = resolveWorkspaceSafePath(sourceRelative);

    if (!sourceAbsolute) {
      persisted.push(item);
      continue;
    }

    try {
      const destinationRelative = path.join(destinationRootRelative, sourceRelative).replaceAll("\\", "/");
      const destinationAbsolute = path.join(workspaceRoot, destinationRelative);

      if (item.kind === "report" && sourceRelative.startsWith("playwright-report/")) {
        if (!copiedReportDirectory) {
          const sourceReportDir = path.dirname(sourceAbsolute);
          const reportRelativeDir = path.dirname(sourceRelative);
          const destinationReportDir = path.join(destinationRootAbsolute, reportRelativeDir);
          await cp(sourceReportDir, destinationReportDir, { recursive: true, force: true });
          copiedReportDirectory = true;
        }
        persisted.push({ ...item, path: destinationRelative });
        persistedCount += 1;
        continue;
      }

      await stat(sourceAbsolute);
      await mkdir(path.dirname(destinationAbsolute), { recursive: true });
      await copyFile(sourceAbsolute, destinationAbsolute);
      persisted.push({ ...item, path: destinationRelative });
      persistedCount += 1;
    } catch {
      persisted.push(item);
    }
  }

  return { persistedEvidence: persisted, persistedCount };
};

const toPositiveNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

const normalizeCaseId = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `C${Math.trunc(value)}`;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return undefined;
  }

  if (/^C\d+$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed)) {
    return `C${trimmed}`;
  }

  return undefined;
};

const normalizeSteps = (value: unknown): GeneratedTestStep[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const mapped = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const typed = item as {
        step?: unknown;
        expectedResults?: unknown;
        expected_results?: unknown;
        content?: unknown;
        expected?: unknown;
      };

      const rawStep =
        typeof typed.step === "string"
          ? typed.step
          : typeof typed.content === "string"
          ? typed.content
          : "";
      const step = rawStep.trim();
      if (!step) {
        return undefined;
      }

      const rawExpected =
        typeof typed.expectedResults === "string"
          ? typed.expectedResults
          : typeof typed.expected_results === "string"
          ? typed.expected_results
          : typeof typed.expected === "string"
          ? typed.expected
          : "";

      const expectedResults = rawExpected.trim();
      return expectedResults ? { step, expectedResults } : { step };
    })
    .filter((item): item is GeneratedTestStep => Boolean(item));

  return mapped.length > 0 ? mapped : undefined;
};

const extractJsonCandidates = (text: string): unknown[] => {
  const candidates: unknown[] = [];
  const trimmed = text.trim();

  if (trimmed) {
    try {
      candidates.push(JSON.parse(trimmed));
    } catch {
    }
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = fenceRegex.exec(text);
  while (match) {
    const body = match[1]?.trim();
    if (body) {
      try {
        candidates.push(JSON.parse(body));
      } catch {
      }
    }
    match = fenceRegex.exec(text);
  }

  return candidates;
};

const parseGeneratedCasesFromCopilotResponse = (responseText: string, jiraId: string): GeneratedTestCase[] => {
  const defaultSectionId = Number(process.env.TESTRAIL_SECTION_ID || 1621);
  const defaultTypeId = Number(process.env.TESTRAIL_TYPE_ID || 6);
  const candidates = extractJsonCandidates(responseText);

  for (const candidate of candidates) {
    const root = candidate as { generatedCases?: unknown; cases?: unknown };
    const rawCases = Array.isArray(root?.generatedCases)
      ? root.generatedCases
      : Array.isArray(root?.cases)
      ? root.cases
      : Array.isArray(candidate)
      ? candidate
      : undefined;

    if (!Array.isArray(rawCases)) {
      continue;
    }

    const normalized = rawCases
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return undefined;
        }

        const typed = item as {
          title?: unknown;
          refs?: unknown;
          references?: unknown;
          sectionId?: unknown;
          section_id?: unknown;
          typeId?: unknown;
          type_id?: unknown;
          preconditions?: unknown;
          custom_preconds?: unknown;
          steps?: unknown;
          custom_steps_separated?: unknown;
          testrailCaseId?: unknown;
          caseId?: unknown;
          createdCaseId?: unknown;
        };

        const title = typeof typed.title === "string" && typed.title.trim().length > 0
          ? typed.title.trim().slice(0, 120)
          : `Generated test case ${index + 1}`;

        const refsRaw =
          typeof typed.refs === "string"
            ? typed.refs
            : typeof typed.references === "string"
            ? typed.references
            : jiraId;
        const refs = refsRaw.trim() || jiraId;

        const sectionId = toPositiveNumber(typed.sectionId ?? typed.section_id, defaultSectionId);
        const typeId = toPositiveNumber(typed.typeId ?? typed.type_id, defaultTypeId);

        const preconditionsRaw =
          typeof typed.preconditions === "string"
            ? typed.preconditions
            : typeof typed.custom_preconds === "string"
            ? typed.custom_preconds
            : undefined;
        const preconditions = preconditionsRaw?.trim() ? preconditionsRaw.trim() : undefined;

        const steps = normalizeSteps(typed.steps ?? typed.custom_steps_separated);

        const testrailCaseId =
          normalizeCaseId(typed.testrailCaseId) ||
          normalizeCaseId(typed.caseId) ||
          normalizeCaseId(typed.createdCaseId);

        const normalizedCase: GeneratedTestCase = {
          title,
          refs,
          sectionId,
          typeId
        };

        if (preconditions) {
          normalizedCase.preconditions = preconditions;
        }
        if (steps) {
          normalizedCase.steps = steps;
        }
        if (testrailCaseId) {
          normalizedCase.testrailCaseId = testrailCaseId;
        }

        return normalizedCase;
      })
      .filter((item): item is GeneratedTestCase => Boolean(item));

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
};

const resolveGeneratedSpecFiles = async (caseIds: string[]): Promise<{
  specFiles: string[];
  missingCaseIds: string[];
}> => {
  const generatedDir = path.join(workspaceRoot, "tests", "generated");
  const allFiles = await readdir(generatedDir);
  const specFiles = new Set<string>();
  const missingCaseIds: string[] = [];

  for (const caseId of caseIds) {
    const numeric = caseId.toUpperCase().replace(/^C/, "");
    const prefixRegex = new RegExp(`^${numeric}-.*\\.spec\\.ts$`, "i");
    const matched = allFiles.filter((name) => prefixRegex.test(name));

    if (matched.length === 0) {
      missingCaseIds.push(caseId);
      continue;
    }

    for (const fileName of matched) {
      specFiles.add(path.join("tests", "generated", fileName).replaceAll("\\", "/"));
    }
  }

  return {
    specFiles: [...specFiles].sort((left, right) => left.localeCompare(right)),
    missingCaseIds
  };
};

const parseJsonObjectFromText = (text: string): unknown | undefined => {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }

  return undefined;
};

type PlaywrightJsonResult = {
  status?: string;
  duration?: number;
};

type PlaywrightJsonTest = {
  projectName?: string;
  results?: PlaywrightJsonResult[];
};

type PlaywrightJsonSpec = {
  title?: string;
  tests?: PlaywrightJsonTest[];
};

type PlaywrightJsonSuite = {
  title?: string;
  file?: string;
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
};

type PlaywrightJsonReport = {
  suites?: PlaywrightJsonSuite[];
};

const statusIsFailure = (status: string): boolean => {
  const normalized = status.toLowerCase();
  return normalized === "failed" || normalized === "timedout" || normalized === "interrupted";
};

const statusIsSkipped = (status: string): boolean => {
  return status.toLowerCase() === "skipped";
};

const flattenSuites = (suites: PlaywrightJsonSuite[] = []): Array<{ file: string; spec: PlaywrightJsonSpec }> => {
  const flattened: Array<{ file: string; spec: PlaywrightJsonSpec }> = [];
  const visit = (suite: PlaywrightJsonSuite, inheritedFile?: string) => {
    const effectiveFile = suite.file || inheritedFile;
    if (effectiveFile && Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        flattened.push({ file: effectiveFile, spec });
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        visit(child, effectiveFile);
      }
    }
  };

  for (const suite of suites) {
    visit(suite, suite.file);
  }

  return flattened;
};

const deriveAuthoritativeResults = (report: PlaywrightJsonReport): {
  metrics: ExecutionMetrics;
  testResults: AutomationTestResult[];
} => {
  const flattened = flattenSuites(report.suites || []);
  const merged = new Map<string, AutomationTestResult>();

  for (const item of flattened) {
    const title = item.spec.title || "Untitled spec";
    const tests = Array.isArray(item.spec.tests) ? item.spec.tests : [];
    const projectStatuses = tests.map((test) => {
      const projectName = test.projectName || "unknown";
      const allResults = Array.isArray(test.results) ? test.results : [];
      const finalResult = allResults.length > 0 ? allResults[allResults.length - 1] : undefined;
      const finalStatus = finalResult?.status || "unknown";
      const durationMs = Number(finalResult?.duration || 0);
      return {
        projectName,
        status: finalStatus,
        durationMs
      };
    });

    const relativeFile = item.file.replaceAll("\\", "/");
    const testId = `${relativeFile}::${title}`;
    const existing = merged.get(testId);
    if (!existing) {
      merged.set(testId, {
        testId,
        file: relativeFile,
        title,
        status: "passed",
        durationMs: 0,
        projectStatuses: []
      });
    }

    const target = merged.get(testId)!;
    target.projectStatuses.push(...projectStatuses);
    target.durationMs += projectStatuses.reduce((acc, current) => acc + current.durationMs, 0);
  }

  const results = [...merged.values()].map((item) => {
    const hasFailure = item.projectStatuses.some((project) => statusIsFailure(project.status));
    const allSkipped =
      item.projectStatuses.length > 0 && item.projectStatuses.every((project) => statusIsSkipped(project.status));
    const status: AutomationTestResult["status"] = hasFailure ? "failed" : allSkipped ? "skipped" : "passed";
    return {
      ...item,
      status
    };
  });

  const passed = results.filter((item) => item.status === "passed").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const total = results.length;
  const durationMs = results.reduce((acc, current) => acc + current.durationMs, 0);

  return {
    metrics: {
      total,
      passed,
      failed,
      durationMs
    },
    testResults: results
  };
};

const runPlaywrightForSpecs = async (jobId: string, specFiles: string[]): Promise<{
  metrics: ExecutionMetrics;
  testResults: AutomationTestResult[];
  reportIndexRelativePath: string;
  testResultsRelativePath: string;
  timedOut: boolean;
}> => {
  const reportDirRelativePath = path.join("playwright-report", jobId).replaceAll("\\", "/");
  const reportIndexRelativePath = path.join(reportDirRelativePath, "index.html").replaceAll("\\", "/");
  const testResultsRelativePath = path.join("test-results", jobId).replaceAll("\\", "/");
  const jsonOutputPath = path.join(workspaceRoot, testResultsRelativePath, "results.json");

  await mkdir(path.dirname(jsonOutputPath), { recursive: true });

  const args = [
    "playwright",
    "test",
    ...specFiles,
    "--reporter=json,html",
    "--output",
    testResultsRelativePath
  ];

  const timeoutMs = Number(process.env.PLAYWRIGHT_EXEC_TIMEOUT_MS || 600000);

  const execution = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn("npx", args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(workspaceRoot, reportDirRelativePath),
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputPath
      },
      shell: process.platform === "win32"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

  let parsed: unknown;
  try {
    const jsonText = await readFile(jsonOutputPath, "utf8");
    parsed = parseJsonObjectFromText(jsonText);
  } catch {
    parsed = parseJsonObjectFromText(execution.stdout);
  }

  const report = parsed as PlaywrightJsonReport | undefined;
  const derived = report ? deriveAuthoritativeResults(report) : {
    metrics: {
      total: 0,
      passed: 0,
      failed: 0,
      durationMs: 0
    },
    testResults: []
  };

  if (execution.code !== 0 && execution.stderr.trim().length > 0) {
    console.warn(
      JSON.stringify({
        level: "warning",
        scope: "job-processor",
        action: "playwright_execution_non_zero",
        jobId,
        code: execution.code,
        stderrPreview: execution.stderr.slice(0, 1000)
      })
    );
  }

  return {
    metrics: derived.metrics,
    testResults: derived.testResults,
    reportIndexRelativePath,
    testResultsRelativePath,
    timedOut: execution.timedOut
  };
};

const runGenerateTestCases = async (jobId: string) => {
  const job = getJob(jobId);
  if (!job || !job.payload.jiraId) {
    throw new Error("Jira ID is required for generate_test_cases jobs.");
  }

  console.log(
    JSON.stringify({
      level: "info",
      scope: "job-processor",
      action: "generate_test_cases_start",
      jobId,
      jiraId: job.payload.jiraId
    })
  );

  addJobEvent(jobId, `Starting Jira ingestion for ${job.payload.jiraId}`);
  const jiraResult = await runLegacyJiraFlow(job.payload.jiraId);
  console.log(
    JSON.stringify({
      level: "info",
      scope: "job-processor",
      action: "jira_ingestion_complete",
      jobId,
      jiraId: job.payload.jiraId,
      n8nResponsePath: jiraResult.filePath
    })
  );

  patchJob(jobId, { payload: { n8nResponsePath: jiraResult.filePath } });
  addJobEvent(jobId, `Saved n8n response at ${jiraResult.filePath}`);

  try {
    const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS || 180000);
    const orchestrationGuard = await Promise.race<
      | { kind: "success"; result: Awaited<ReturnType<typeof runCopilotWorkflow>> }
      | { kind: "timeout" }
    >([
      runCopilotWorkflow({
        workflowType: "generate_test_cases",
        userInput: [
          `Jira ID: ${job.payload.jiraId}`,
          `Platform n8n response path: ${jiraResult.filePath}`,
          "IMPORTANT: The platform already executed Jira->n8n ingestion.",
          "Do NOT run CLI commands and do NOT call n8n.",
          "You must parse the provided n8n response file and create/reconcile TestRail cases using MCP tools only.",
          "Return strict JSON only using the prompt output contract."
        ].join("\n")
      }).then((result) => ({ kind: "success", result } as const)),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs + 5000);
      })
    ]);

    if (orchestrationGuard.kind === "timeout") {
      patchJob(jobId, { payload: { generatedCases: [], caseIds: [] } });
      const warning = `Copilot orchestration exceeded ${timeoutMs}ms before structured case output was finalized. Marking as completed with warning.`;
      addJobEvent(jobId, warning);
      console.warn(
        JSON.stringify({
          level: "warning",
          scope: "job-processor",
          action: "copilot_test_case_orchestration_timeout_guard_non_fatal",
          jobId,
          jiraId: job.payload.jiraId,
          timeoutMs
        })
      );
      return;
    }

    const orchestrationResult = orchestrationGuard.result;
    const responsePath = await persistCopilotResponse(
      jobId,
      "generate_test_cases",
      orchestrationResult.responseFull
    );

    const mappedCases = parseGeneratedCasesFromCopilotResponse(
      orchestrationResult.responseFull,
      job.payload.jiraId
    );
    const createdCount = mappedCases.filter((item) => Boolean(item.testrailCaseId)).length;
    patchJob(jobId, {
      payload: {
        generatedCases: mappedCases,
        caseIds: mappedCases
          .map((item) => item.testrailCaseId)
          .filter((item): item is string => Boolean(item))
      }
    });
    addJobEvent(jobId, `Prepared ${mappedCases.length} generated test cases`);
    addJobEvent(jobId, `Synchronized generated cases to TestRail via Copilot MCP (${createdCount}/${mappedCases.length} created)`);

    if (mappedCases.length === 0) {
      addJobEvent(jobId, "Copilot returned no parseable generated cases in strict JSON format.");
      console.warn(
        JSON.stringify({
          level: "warning",
          scope: "job-processor",
          action: "copilot_test_case_output_parse_empty",
          jobId,
          jiraId: job.payload.jiraId
        })
      );
    }

    console.log(
      JSON.stringify({
        level: "info",
        scope: "job-processor",
        action: "testrail_sync_complete",
        jobId,
        jiraId: job.payload.jiraId,
        generatedCaseCount: mappedCases.length,
        syncedCaseCount: createdCount
      })
    );

    addJobEvent(jobId, orchestrationResult.summary);
    if (orchestrationResult.responsePreview) {
      addJobEvent(jobId, `Copilot response preview: ${orchestrationResult.responsePreview}`);
    }
    addJobEvent(jobId, `Copilot full response saved at ${responsePath}`);
    console.log(
      JSON.stringify({
        level: "info",
        scope: "job-processor",
        action: "copilot_test_case_orchestration_complete",
        jobId,
        jiraId: job.payload.jiraId
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|session\.idle/i.test(message)) {
      patchJob(jobId, { payload: { generatedCases: [], caseIds: [] } });
      addJobEvent(jobId, `Copilot orchestration timed out before structured case output was finalized: ${message}`);
      console.warn(
        JSON.stringify({
          level: "warning",
          scope: "job-processor",
          action: "copilot_test_case_orchestration_timeout_non_fatal",
          jobId,
          jiraId: job.payload.jiraId,
          error: message
        })
      );
      return;
    }
    throw error;
  }
};

const runGenerateAutomation = async (jobId: string) => {
  const job = getJob(jobId);
  if (!job || !job.payload.caseIds || job.payload.caseIds.length === 0) {
    throw new Error("At least one TestRail case ID is required for generate_automation jobs.");
  }

  console.log(
    JSON.stringify({
      level: "info",
      scope: "job-processor",
      action: "generate_automation_start",
      jobId,
      caseCount: job.payload.caseIds.length
    })
  );

  addJobEvent(jobId, `Starting automation generation for ${job.payload.caseIds.join(", ")}`);

  const vibiumEnabled = process.env.COPILOT_ENABLE_VIBIUM_MCP === "true";
  if (vibiumEnabled) {
    addJobEvent(jobId, "Browser MCP mode: vibium-enabled (playwright fallback remains available).");
  } else {
    addJobEvent(jobId, "Browser MCP mode: playwright-fallback-active (vibium disabled).");
  }

  try {
    await getCaseFromTestrail(job.payload.caseIds[0]);
    addJobEvent(jobId, `Validated TestRail access with case ${job.payload.caseIds[0]}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`TestRail preflight failed for ${job.payload.caseIds[0]}: ${message}`);
  }

  try {
    const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS || 180000);
    const orchestrationGuard = await Promise.race<
      | { kind: "success"; result: Awaited<ReturnType<typeof runCopilotWorkflow>> }
      | { kind: "timeout" }
    >([
      runCopilotWorkflow({
        workflowType: "generate_automation",
        userInput: `caseIds: ${JSON.stringify(job.payload.caseIds)}`
      }).then((result) => ({ kind: "success", result } as const)),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs + 5000);
      })
    ]);

    if (orchestrationGuard.kind === "timeout") {
      const warning = `Copilot automation orchestration exceeded ${timeoutMs}ms. Marking as completed with warning.`;
      addJobEvent(jobId, warning);
      console.warn(
        JSON.stringify({
          level: "warning",
          scope: "job-processor",
          action: "copilot_automation_orchestration_timeout_guard_non_fatal",
          jobId,
          caseCount: job.payload.caseIds.length,
          timeoutMs
        })
      );
    } else {
      const orchestrationResult = orchestrationGuard.result;
      const responsePath = await persistCopilotResponse(
        jobId,
        "generate_automation",
        orchestrationResult.responseFull
      );
      addJobEvent(jobId, orchestrationResult.summary);
      if (orchestrationResult.responsePreview) {
        addJobEvent(jobId, `Copilot response preview: ${orchestrationResult.responsePreview}`);
      }
      addJobEvent(jobId, `Copilot full response saved at ${responsePath}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|session\.idle/i.test(message)) {
      addJobEvent(jobId, `Copilot automation orchestration timed out: ${message}`);
      console.warn(
        JSON.stringify({
          level: "warning",
          scope: "job-processor",
          action: "copilot_automation_orchestration_timeout_non_fatal",
          jobId,
          caseCount: job.payload.caseIds.length,
          error: message
        })
      );
    } else {
      throw error;
    }
  }

  const resolvedSpecs = await resolveGeneratedSpecFiles(job.payload.caseIds);
  addJobEvent(
    jobId,
    `Resolved generated Playwright specs (${resolvedSpecs.specFiles.length}/${job.payload.caseIds.length} case IDs matched)`
  );
  if (resolvedSpecs.missingCaseIds.length > 0) {
    addJobEvent(jobId, `No generated spec file found for: ${resolvedSpecs.missingCaseIds.join(", ")}`);
  }

  const executionStartIso = new Date().toISOString();
  const playwrightExecution =
    resolvedSpecs.specFiles.length > 0
      ? await runPlaywrightForSpecs(jobId, resolvedSpecs.specFiles)
      : {
          metrics: {
            total: 0,
            passed: 0,
            failed: 0,
            durationMs: 0
          },
          testResults: [] as AutomationTestResult[],
          reportIndexRelativePath: path.join("playwright-report", jobId, "index.html").replaceAll("\\", "/"),
          testResultsRelativePath: path.join("test-results", jobId).replaceAll("\\", "/"),
          timedOut: false
        };

  if (playwrightExecution.timedOut) {
    addJobEvent(jobId, "Playwright execution timed out before completion.");
  }

  const execution = await collectExecutionEvidence({
    sinceIso: executionStartIso,
    testResultsPath: playwrightExecution.testResultsRelativePath,
    reportPath: playwrightExecution.reportIndexRelativePath
  });

  const persistedArtifacts = await persistAutomationArtifacts(jobId, execution.evidence);
  patchJob(jobId, {
    payload: {
      automationMetrics: playwrightExecution.metrics,
      automationTestResults: playwrightExecution.testResults,
      evidence: persistedArtifacts.persistedEvidence
    }
  });
  addJobEvent(
    jobId,
    `Persisted automation artifacts to stable storage (${persistedArtifacts.persistedCount}/${execution.evidence.length})`
  );
  if (execution.evidence.length === 0) {
    addJobEvent(jobId, "No fresh Playwright evidence was found for this job window.");
  }
  if (playwrightExecution.metrics.total === 0) {
    addJobEvent(jobId, "Execution metrics unavailable (structured Playwright results not produced by this run).");
  }
  addJobEvent(
    jobId,
    `Authoritative Playwright results: ${playwrightExecution.metrics.passed}/${playwrightExecution.metrics.total} passed, ${playwrightExecution.metrics.failed} failed`
  );
  addJobEvent(jobId, "Collected execution metrics and evidence artifacts");
  console.log(
    JSON.stringify({
      level: "info",
      scope: "job-processor",
      action: "generate_automation_complete",
      jobId,
      caseCount: job.payload.caseIds.length,
      executedSpecFiles: resolvedSpecs.specFiles.length,
      authoritativeTotal: playwrightExecution.metrics.total,
      authoritativePassed: playwrightExecution.metrics.passed,
      authoritativeFailed: playwrightExecution.metrics.failed,
      persistedArtifacts: persistedArtifacts.persistedCount,
      totalArtifacts: execution.evidence.length
    })
  );
};

export const processJob = async (jobId: string): Promise<void> => {
  const job = getJob(jobId);
  if (!job) {
    return;
  }

  console.log(
    JSON.stringify({
      level: "info",
      scope: "job-processor",
      action: "process_job_start",
      jobId,
      type: job.type,
      status: job.status
    })
  );

  try {
    if (job.status !== "running") {
      setJobStatus(jobId, "running");
    }
    if (job.type === "generate_test_cases") {
      await runGenerateTestCases(jobId);
    } else {
      await runGenerateAutomation(jobId);
    }
    setJobStatus(jobId, "completed");
    console.log(
      JSON.stringify({
        level: "info",
        scope: "job-processor",
        action: "process_job_complete",
        jobId,
        type: job.type
      })
    );
  } catch (error) {
    patchJob(jobId, { error: error instanceof Error ? error.message : String(error) });
    setJobStatus(jobId, "failed");
    addJobEvent(jobId, "Job failed");
    console.error(
      JSON.stringify({
        level: "error",
        scope: "job-processor",
        action: "process_job_failed",
        jobId,
        type: job.type,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
};