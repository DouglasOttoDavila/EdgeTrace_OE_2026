export type WorkflowJobType = "generate_test_cases" | "generate_automation";

export type WorkflowJobStatus = "queued" | "running" | "completed" | "failed";

export interface GeneratedTestStep {
  step: string;
  expectedResults?: string;
}

export interface GeneratedTestCase {
  title: string;
  refs: string;
  sectionId: number;
  typeId: number;
  preconditions?: string;
  steps?: GeneratedTestStep[];
  testrailCaseId?: string;
}

export interface EvidenceArtifact {
  path: string;
  kind: "screenshot" | "video" | "report" | "trace";
}

export interface ExecutionMetrics {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

export interface AutomationTestResult {
  testId: string;
  file: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  projectStatuses: Array<{
    projectName: string;
    status: string;
    durationMs: number;
  }>;
}

export interface WorkflowJobPayload {
  jiraId?: string;
  caseIds?: string[];
  generatedCases?: GeneratedTestCase[];
  automationMetrics?: ExecutionMetrics;
  automationTestResults?: AutomationTestResult[];
  evidence?: EvidenceArtifact[];
  n8nResponsePath?: string;
}

export interface WorkflowJob {
  id: string;
  type: WorkflowJobType;
  status: WorkflowJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  payload: WorkflowJobPayload;
  events: Array<{ timestamp: string; message: string }>;
}