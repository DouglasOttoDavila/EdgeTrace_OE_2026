const path = require("node:path");
const Database = require("better-sqlite3");

const mode = process.argv[2] || "finished";
const dbPath = path.resolve(__dirname, "..", "..", "..", "data", "platform", "jobs.db");

const db = new Database(dbPath);

const summarize = () =>
  db.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY status ASC").all();

const before = summarize();

if (mode === "all") {
  db.exec("DELETE FROM job_events; DELETE FROM jobs;");
} else {
  db.exec(
    "DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE status IN ('completed','failed')); DELETE FROM jobs WHERE status IN ('completed','failed');"
  );
}

const after = summarize();

console.log(
  JSON.stringify(
    {
      mode,
      dbPath,
      before,
      after
    },
    null,
    2
  )
);