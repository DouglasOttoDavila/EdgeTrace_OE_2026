import { randomUUID } from "node:crypto";
import type { WorkflowJob, WorkflowJobPayload, WorkflowJobStatus, WorkflowJobType } from "./types";
import { db } from "./db";

const nowIso = () => new Date().toISOString();

type JobRow = {
  id: string;
  type: WorkflowJobType;
  status: WorkflowJobStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  payload_json: string;
};

type EventRow = {
  timestamp: string;
  message: string;
};

const getEventsForJob = db.prepare(
  `SELECT timestamp, message FROM job_events WHERE job_id = ? ORDER BY id ASC`
);

const rowToJob = (row: JobRow): WorkflowJob => {
  const events = (getEventsForJob.all(row.id) as EventRow[]).map((item) => ({
    timestamp: item.timestamp,
    message: item.message
  }));

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    finishedAt: row.finished_at || undefined,
    error: row.error || undefined,
    payload: JSON.parse(row.payload_json) as WorkflowJobPayload,
    events
  };
};

const insertJobStmt = db.prepare(
  `INSERT INTO jobs (id, type, status, created_at, updated_at, payload_json)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const insertEventStmt = db.prepare(
  `INSERT INTO job_events (job_id, timestamp, message)
   VALUES (?, ?, ?)`
);

const getJobStmt = db.prepare(
  `SELECT id, type, status, created_at, updated_at, started_at, finished_at, error, payload_json
   FROM jobs WHERE id = ?`
);

const listJobsStmt = db.prepare(
  `SELECT id, type, status, created_at, updated_at, started_at, finished_at, error, payload_json
   FROM jobs ORDER BY created_at DESC`
);

const updateJobStmt = db.prepare(
  `UPDATE jobs SET
    status = ?,
    updated_at = ?,
    started_at = ?,
    finished_at = ?,
    error = ?,
    payload_json = ?
   WHERE id = ?`
);

const claimNextQueuedIdStmt = db.prepare(
  `SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
);

const claimQueuedJobStmt = db.prepare(
  `UPDATE jobs
   SET status = 'running',
       updated_at = ?,
       started_at = COALESCE(started_at, ?)
   WHERE id = ? AND status = 'queued'`
);

const deleteJobEventsStmt = db.prepare(`DELETE FROM job_events WHERE job_id = ?`);
const deleteJobStmt = db.prepare(`DELETE FROM jobs WHERE id = ?`);

export const createJob = (type: WorkflowJobType, payload: WorkflowJobPayload): WorkflowJob => {
  const timestamp = nowIso();
  const id = randomUUID();

  insertJobStmt.run(id, type, "queued", timestamp, timestamp, JSON.stringify(payload));
  insertEventStmt.run(id, timestamp, "Job queued");

  const row = getJobStmt.get(id) as JobRow;
  return rowToJob(row);
};

export const listJobs = (): WorkflowJob[] => {
  return (listJobsStmt.all() as JobRow[]).map(rowToJob);
};

export const getJob = (jobId: string): WorkflowJob | undefined => {
  const row = getJobStmt.get(jobId) as JobRow | undefined;
  if (!row) {
    return undefined;
  }
  return rowToJob(row);
};

export const patchJob = (
  jobId: string,
  patch: Partial<Omit<WorkflowJob, "id" | "createdAt" | "events">>
): WorkflowJob => {
  const current = getJob(jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const updated: WorkflowJob = {
    ...current,
    ...patch,
    payload: patch.payload ? { ...current.payload, ...patch.payload } : current.payload,
    updatedAt: nowIso()
  };

  updateJobStmt.run(
    updated.status,
    updated.updatedAt,
    updated.startedAt || null,
    updated.finishedAt || null,
    updated.error || null,
    JSON.stringify(updated.payload),
    updated.id
  );

  return updated;
};

export const setJobStatus = (jobId: string, status: WorkflowJobStatus): WorkflowJob => {
  const current = getJob(jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const patch: Partial<WorkflowJob> = { status };
  if (status === "running" && !current.startedAt) {
    patch.startedAt = nowIso();
  }
  if (status === "completed" || status === "failed") {
    patch.finishedAt = nowIso();
  }

  return patchJob(jobId, patch);
};

export const addJobEvent = (jobId: string, message: string): WorkflowJob => {
  const current = getJob(jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const timestamp = nowIso();
  insertEventStmt.run(jobId, timestamp, message);

  const updated: WorkflowJob = {
    ...current,
    updatedAt: timestamp,
    events: [...current.events, { timestamp, message }]
  };

  updateJobStmt.run(
    updated.status,
    updated.updatedAt,
    updated.startedAt || null,
    updated.finishedAt || null,
    updated.error || null,
    JSON.stringify(updated.payload),
    updated.id
  );

  return updated;
};

export const claimNextQueuedJob = (): WorkflowJob | undefined => {
  const transaction = db.transaction(() => {
    const row = claimNextQueuedIdStmt.get() as { id: string } | undefined;
    if (!row) {
      return undefined;
    }

    const timestamp = nowIso();
    const result = claimQueuedJobStmt.run(timestamp, timestamp, row.id);
    if (result.changes === 0) {
      return undefined;
    }

    insertEventStmt.run(row.id, timestamp, "Worker claimed queued job");
    const claimed = getJob(row.id);
    return claimed;
  });

  return transaction();
};

export const deleteJob = (jobId: string): boolean => {
  const transaction = db.transaction(() => {
    const current = getJob(jobId);
    if (!current) {
      return false;
    }

    if (current.status === "running") {
      throw new Error("Cannot delete a running job.");
    }

    deleteJobEventsStmt.run(jobId);
    const result = deleteJobStmt.run(jobId);
    return result.changes > 0;
  });

  return transaction();
};