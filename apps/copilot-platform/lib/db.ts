import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const databaseDir = path.join(workspaceRoot, "data", "platform");
const databasePath = path.join(databaseDir, "jobs.db");

mkdirSync(databaseDir, { recursive: true });

const db = new Database(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    payload_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
`);

export { db, databasePath };