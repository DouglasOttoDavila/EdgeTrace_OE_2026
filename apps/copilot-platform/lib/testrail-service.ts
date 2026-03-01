import type { EvidenceArtifact, ExecutionMetrics } from "./types";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const scanArtifacts = async (folderPath: string): Promise<string[]> => {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await scanArtifacts(fullPath)));
      continue;
    }
    results.push(fullPath);
  }

  return results;
};

export const collectExecutionEvidence = async (options?: {
  sinceIso?: string;
  testResultsPath?: string;
  reportPath?: string;
}): Promise<{
  metrics: ExecutionMetrics;
  evidence: EvidenceArtifact[];
}> => {
  const testResultsPath = options?.testResultsPath
    ? path.resolve(workspaceRoot, options.testResultsPath)
    : path.join(workspaceRoot, "test-results");
  const reportPath = options?.reportPath
    ? path.resolve(workspaceRoot, options.reportPath)
    : path.join(workspaceRoot, "playwright-report", "index.html");
  const sinceMs = options?.sinceIso ? new Date(options.sinceIso).getTime() : NaN;
  const hasSinceFilter = Number.isFinite(sinceMs);

  let files: string[] = [];
  try {
    files = await scanArtifacts(testResultsPath);
  } catch {
    files = [];
  }

  const collected: EvidenceArtifact[] = [];
  for (const filePath of files) {
    if (!/\.(png|jpg|jpeg|webm|mp4|zip)$/i.test(filePath)) {
      continue;
    }

    try {
      const metadata = await stat(filePath);
      if (metadata.size <= 0) {
        continue;
      }
      if (hasSinceFilter && metadata.mtimeMs < sinceMs - 2000) {
        continue;
      }

      const lower = filePath.toLowerCase();
      let kind: EvidenceArtifact["kind"] = "trace";
      if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        kind = "screenshot";
      } else if (lower.endsWith(".mp4") || lower.endsWith(".webm")) {
        kind = "video";
      }
      collected.push({
        path: path.relative(workspaceRoot, filePath).replaceAll("\\", "/"),
        kind
      });
    } catch {
    }
  }

  try {
    const reportStats = await stat(reportPath);
    if (reportStats.size > 0 && (!hasSinceFilter || reportStats.mtimeMs >= sinceMs - 2000)) {
      collected.push({ path: path.relative(workspaceRoot, reportPath).replaceAll("\\", "/"), kind: "report" });
    }
  } catch {
  }

  const total = 0;
  const passed = 0;
  const failed = 0;

  return {
    metrics: {
      total,
      passed,
      failed,
      durationMs: 0
    },
    evidence: collected
  };
};