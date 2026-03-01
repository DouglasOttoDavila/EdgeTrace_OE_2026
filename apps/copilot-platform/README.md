# Copilot Platform App

This app is the first implementation phase of the Copilot SDK migration.

## Scope in this phase
- Async job orchestration for:
  - Jira ID -> test case generation -> TestRail mapping
  - TestRail case IDs -> automation generation -> execution metrics/evidence collection
- API routes:
  - `POST /api/jobs`
  - `GET /api/jobs`
  - `GET /api/jobs/:jobId`
- Dashboard UI to trigger and monitor workflows.

## Run
From repository root:

```bash
npm --prefix apps/copilot-platform install
npm run platform:dev
npm run platform:worker
```

Open http://localhost:3000.

## Notes
- Existing CLI flow in `src/jira-to-testrail` remains active and is reused by the new backend.
- Copilot SDK sessions now execute directly via authenticated `CopilotClient`.
- Prompt contracts are loaded from `.github/prompts` and sent as workflow instructions.
- Job state is persisted in SQLite at `data/platform/jobs.db`.
- Live dashboard updates are delivered via SSE (`/api/jobs/stream`).
- Evidence artifacts are previewed through `/api/artifacts?path=...`.

## Runtime environment
- `TESTRAIL_BASE_URL`, `TESTRAIL_USER`, `TESTRAIL_API_KEY` for real TestRail API case creation.
- `COPILOT_CLI_PATH` (default: `copilot`)
- `COPILOT_CLI_URL` (optional, example: `localhost:4321`)
- `COPILOT_CLI_PORT` (default: `4321`, used by managed Windows headless mode)
- `COPILOT_MODEL` (default: `gpt-5`)
- `COPILOT_TIMEOUT_MS` (default: `180000`)
- `PLATFORM_WORKER_POLL_MS` (default: `1500`)

If local CLI spawning fails on your machine, run Copilot CLI in server mode and connect via URL:

```bash
copilot --headless --port 4321
```

Then set `COPILOT_CLI_URL=localhost:4321`.

On Windows, when `COPILOT_CLI_URL` is not set, the app automatically attempts managed headless mode (`copilot --headless --port <COPILOT_CLI_PORT>`) and connects via `cliUrl`.

Authentication requirement:
- Run `copilot auth login` in your environment (or configure token/BYOK) before starting generation jobs.