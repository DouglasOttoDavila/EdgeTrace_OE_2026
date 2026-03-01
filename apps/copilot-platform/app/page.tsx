"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type WorkflowJob = {
  id: string;
  type: "generate_test_cases" | "generate_automation";
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string;
  payload: {
    jiraId?: string;
    caseIds?: string[];
    generatedCases?: Array<{
      title: string;
      refs: string;
      sectionId: number;
      typeId: number;
      testrailCaseId?: string;
    }>;
    automationMetrics?: {
      total: number;
      passed: number;
      failed: number;
      durationMs: number;
    };
    automationTestResults?: Array<{
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
    }>;
    evidence?: Array<{
      path: string;
      kind: "screenshot" | "video" | "report" | "trace";
    }>;
  };
  events: Array<{ timestamp: string; message: string }>;
};

const statusTone: Record<WorkflowJob["status"], string> = {
  queued: "border-white/30 bg-white/10 text-slate-100",
  running: "border-sky-300/60 bg-sky-400/20 text-sky-100",
  completed: "border-emerald-300/70 bg-emerald-400/20 text-emerald-100",
  failed: "border-rose-300/70 bg-rose-400/20 text-rose-100"
};

const formatDuration = (durationMs?: number) => {
  if (!durationMs) {
    return "-";
  }
  const seconds = Math.floor(durationMs / 1000);
  return `${seconds}s`;
};

const artifactUrl = (relativePath: string) => {
  const normalized = relativePath.replaceAll("\\", "/");
  const encodedPath = normalized
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/api/artifacts/file/${encodedPath}`;
};

const testrailBaseUrl = (process.env.NEXT_PUBLIC_TESTRAIL_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const testrailCaseUrl = (caseId?: string) => {
  if (!caseId || !testrailBaseUrl) {
    return null;
  }

  const numericCaseId = caseId.replace(/^\D+/u, "");
  if (!numericCaseId) {
    return null;
  }

  return `${testrailBaseUrl}/index.php?/cases/view/${encodeURIComponent(
    numericCaseId
  )}`;
};

type GeneratedCaseRow = {
  title: string;
  refs: string;
  testrailCaseId?: string;
};

const GeneratedCasesTable = (props: {
  jobId: string;
  generatedCases: GeneratedCaseRow[];
  canGenerateAutomation: boolean;
  onGenerateAutomation: (caseId: string) => void;
  isCaseBusy: (caseId?: string) => boolean;
}) => {
  return (
    <div className="glass-subpanel glass-scroll mt-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-slate-300">
            <th className="px-3 py-2">Case ID</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Refs</th>
            <th className="px-3 py-2">Automation</th>
          </tr>
        </thead>
        <tbody>
          {props.generatedCases.map((testCase, index) => {
            const caseUrl = testrailCaseUrl(testCase.testrailCaseId);
            const isBusy = props.isCaseBusy(testCase.testrailCaseId);
            const canGenerateThisCase =
              props.canGenerateAutomation &&
              Boolean(testCase.testrailCaseId) &&
              !isBusy;

            return (
              <tr
                key={`${props.jobId}-${testCase.testrailCaseId || testCase.title}-${index}`}
                className="border-b border-white/10 text-slate-100"
              >
                <td className="px-3 py-2 font-mono text-sky-200">
                  {testCase.testrailCaseId ? (
                    caseUrl ? (
                      <a
                        href={caseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-sky-300/50 underline-offset-2 transition hover:text-sky-100"
                      >
                        {testCase.testrailCaseId}
                      </a>
                    ) : (
                      testCase.testrailCaseId
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2">{testCase.title}</td>
                <td className="px-3 py-2 text-slate-200">{testCase.refs}</td>
                <td className="px-3 py-2">
                  <button
                    className="glass-button-secondary px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      if (testCase.testrailCaseId) {
                        props.onGenerateAutomation(testCase.testrailCaseId);
                      }
                    }}
                    disabled={!canGenerateThisCase}
                    title={
                      !testCase.testrailCaseId
                        ? "No TestRail case ID available"
                        : !props.canGenerateAutomation
                        ? "Test case generation job must be completed"
                        : isBusy
                        ? "Automation generation is already queued/running for this case"
                        : "Generate automation for this case"
                    }
                  >
                    {isBusy ? "Generating..." : "Generate Automation"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default function HomePage() {
  const [jiraId, setJiraId] = useState("WORKSHOP26-1");
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [pendingAutomationCaseIds, setPendingAutomationCaseIds] = useState<string[]>([]);

  const loadJobs = async () => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const data = (await response.json()) as { jobs: WorkflowJob[] };
    setJobs(data.jobs ?? []);
  };

  useEffect(() => {
    void loadJobs();
    const eventSource = new EventSource("/api/jobs/stream");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { jobs?: WorkflowJob[] };
        setJobs(payload.jobs ?? []);
      } catch {
        void loadJobs();
      }
    };

    eventSource.onerror = () => {
      void loadJobs();
    };

    return () => eventSource.close();
  }, []);

  const latestTestCaseJob = useMemo(
    () => jobs.find((job) => job.type === "generate_test_cases"),
    [jobs]
  );

  const queuedOrRunningAutomationCaseIds = useMemo(() => {
    const activeCaseIds = new Set<string>();

    for (const job of jobs) {
      if (
        job.type === "generate_automation" &&
        (job.status === "queued" || job.status === "running")
      ) {
        for (const caseId of job.payload.caseIds ?? []) {
          activeCaseIds.add(caseId);
        }
      }
    }

    return activeCaseIds;
  }, [jobs]);

  const triggerCaseGeneration = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "generate_test_cases", jiraId })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not start test case generation.");
      }

      await loadJobs();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerAutomationGeneration = async (caseId: string) => {
    setError(null);
    if (!caseId) {
      setError("No synced TestRail case ID is available yet. Verify TestRail sync before triggering automation.");
      return;
    }

    setPendingAutomationCaseIds((previous) =>
      previous.includes(caseId) ? previous : [...previous, caseId]
    );

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "generate_automation", caseIds: [caseId] })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not start automation generation.");
      }

      await loadJobs();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown error");
    } finally {
      setPendingAutomationCaseIds((previous) =>
        previous.filter((pendingCaseId) => pendingCaseId !== caseId)
      );
    }
  };

  const isAutomationBusyForCase = (caseId?: string) => {
    if (!caseId) {
      return false;
    }

    return (
      pendingAutomationCaseIds.includes(caseId) ||
      queuedOrRunningAutomationCaseIds.has(caseId)
    );
  };

  const deleteJobById = async (jobId: string) => {
    setError(null);
    const confirmed = window.confirm(`Delete job ${jobId}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setDeletingJobId(jobId);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not delete job.");
      }

      await loadJobs();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown error");
    } finally {
      setDeletingJobId(null);
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="glass-panel relative overflow-hidden p-6 sm:p-8">
          <div className="pr-36 sm:pr-44 md:pr-56 lg:pr-64">
            <p className="glass-chip mb-4 inline-flex border-sky-200/30 bg-sky-300/15 text-sky-100">
              Live Workflow Console
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              EdgeTrace
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-200 sm:text-base">
              Trigger Jira-based test case generation, sync with TestRail, launch
              automation generation, and monitor execution evidence.
            </p>
          </div>

          <div className="pointer-events-none absolute inset-y-6 right-6 flex items-center gap-2 sm:inset-y-8 sm:right-8 sm:gap-3">
            <Image
              src="/branding/oe_logo.png"
              alt="Object Edge logo"
              width={1696}
              height={1655}
              priority
              className="h-full w-auto object-contain"
            />
            <Image
              src="/branding/edgetrace-logo.png"
              alt="EdgeTrace logo"
              width={640}
              height={640}
              priority
              className="h-full w-auto object-contain"
            />
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="glass-panel p-6">
            <h2 className="text-lg font-semibold text-white">Generate Test Cases</h2>
            <p className="mt-2 text-sm text-slate-200">
              Start the Jira → n8n → TestRail generation flow.
            </p>

            <label className="mt-5 block text-sm text-slate-200" htmlFor="jira-id">
              Jira ID
            </label>
            <input
              id="jira-id"
              className="glass-input mt-2"
              value={jiraId}
              onChange={(event) => setJiraId(event.target.value.toUpperCase())}
              placeholder="QAT-114"
            />

            <button
              className="glass-button-primary mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              onClick={triggerCaseGeneration}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Starting..." : "Generate and Send to TestRail"}
            </button>

            {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
          </div>

          <div className="glass-panel p-6">
            <h2 className="text-lg font-semibold text-white">
              Latest Generated Test Cases
            </h2>
            {!latestTestCaseJob?.payload.generatedCases?.length ? (
              <p className="mt-3 text-sm text-slate-300">No generated test cases yet.</p>
            ) : (
              <GeneratedCasesTable
                jobId={latestTestCaseJob.id}
                generatedCases={latestTestCaseJob.payload.generatedCases}
                canGenerateAutomation={latestTestCaseJob.status === "completed"}
                onGenerateAutomation={triggerAutomationGeneration}
                isCaseBusy={isAutomationBusyForCase}
              />
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {jobs.map((job) => (
            <article
              key={job.id}
              className="glass-panel p-6 transition duration-300 hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-white">
                  {job.type === "generate_test_cases"
                    ? "Test Case Generation"
                    : "Automation Generation"}
                </h3>
                <div className="flex items-center gap-2">
                  <span className={`glass-chip ${statusTone[job.status]}`}>
                    {job.status}
                  </span>
                  <button
                    className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1 text-xs text-rose-100 transition duration-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => deleteJobById(job.id)}
                    disabled={job.status === "running" || deletingJobId === job.id}
                    title={
                      job.status === "running"
                        ? "Running jobs cannot be deleted"
                        : "Delete this job"
                    }
                  >
                    {deletingJobId === job.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-300">Job ID: {job.id}</p>

              {job.type === "generate_test_cases" ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-200">Generated Test Cases</p>
                  {!job.payload.generatedCases?.length ? (
                    <p className="mt-2 text-sm text-slate-300">
                      No generated test cases in this run.
                    </p>
                  ) : (
                    <GeneratedCasesTable
                      jobId={job.id}
                      generatedCases={job.payload.generatedCases}
                      canGenerateAutomation={job.status === "completed"}
                      onGenerateAutomation={triggerAutomationGeneration}
                      isCaseBusy={isAutomationBusyForCase}
                    />
                  )}
                </div>
              ) : null}

              {job.payload.automationMetrics ? (
                <div className="mt-4 grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-4">
                  <div className="glass-subpanel p-3">
                    <p className="text-slate-300">Total</p>
                    <p className="mt-1 text-base text-white">
                      {job.payload.automationMetrics.total}
                    </p>
                  </div>
                  <div className="glass-subpanel p-3">
                    <p className="text-slate-300">Passed</p>
                    <p className="mt-1 text-base text-emerald-200">
                      {job.payload.automationMetrics.passed}
                    </p>
                  </div>
                  <div className="glass-subpanel p-3">
                    <p className="text-slate-300">Failed</p>
                    <p className="mt-1 text-base text-rose-200">
                      {job.payload.automationMetrics.failed}
                    </p>
                  </div>
                  <div className="glass-subpanel p-3">
                    <p className="text-slate-300">Duration</p>
                    <p className="mt-1 text-base text-white">
                      {formatDuration(job.payload.automationMetrics.durationMs)}
                    </p>
                  </div>
                </div>
              ) : null}

              {job.payload.automationTestResults?.length ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-200">Per-Test Results</p>
                  <div className="glass-subpanel glass-scroll mt-2 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-slate-300">
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Test</th>
                          <th className="px-3 py-2">File</th>
                          <th className="px-3 py-2">Projects</th>
                          <th className="px-3 py-2">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.payload.automationTestResults.map((result) => {
                          const statusClassName =
                            result.status === "passed"
                              ? "text-emerald-200"
                              : result.status === "failed"
                              ? "text-rose-200"
                              : "text-amber-200";

                          const projects = result.projectStatuses
                            .map(
                              (project) =>
                                `${project.projectName}:${project.status}`
                            )
                            .join(" | ");

                          return (
                            <tr
                              key={`${job.id}-${result.testId}`}
                              className="border-b border-white/10 text-slate-100"
                            >
                              <td className={`px-3 py-2 font-medium ${statusClassName}`}>
                                {result.status}
                              </td>
                              <td className="px-3 py-2">{result.title}</td>
                              <td className="px-3 py-2 font-mono text-sky-200">
                                {result.file}
                              </td>
                              <td className="px-3 py-2 text-slate-200">
                                {projects || "-"}
                              </td>
                              <td className="px-3 py-2">
                                {formatDuration(result.durationMs)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {job.payload.evidence?.length ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-200">Evidence</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    {job.payload.evidence.map((item) => {
                      const url = artifactUrl(item.path);

                      return (
                        <div
                          key={`${job.id}-${item.path}`}
                          className="glass-subpanel overflow-hidden"
                        >
                          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-slate-300">
                            <span>{item.kind}</span>
                            <a
                              className="text-sky-200 hover:text-sky-100"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              open
                            </a>
                          </div>

                          {item.kind === "screenshot" ? (
                            <img
                              src={url}
                              alt={item.path}
                              className="h-32 w-full object-cover"
                              loading="lazy"
                            />
                          ) : null}

                          {item.kind === "video" ? (
                            <video
                              className="h-32 w-full object-cover"
                              controls
                              preload="metadata"
                            >
                              <source src={url} />
                            </video>
                          ) : null}

                          {item.kind === "report" || item.kind === "trace" ? (
                            <div className="px-3 py-3 text-xs text-slate-200">
                              {item.path}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <p className="text-sm text-slate-200">Execution Timeline</p>
                <ul className="glass-subpanel glass-scroll mt-2 max-h-40 space-y-1 overflow-y-auto p-3 text-xs text-slate-200">
                  {job.events.map((event) => (
                    <li key={`${job.id}-${event.timestamp}-${event.message}`}>
                      <span className="text-slate-300">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>{" "}
                      {event.message}
                    </li>
                  ))}
                </ul>
              </div>

              {job.error ? <p className="mt-3 text-sm text-rose-200">{job.error}</p> : null}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
