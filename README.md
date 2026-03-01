# OE AI Training 2026

This repository provides an Agent Mode workflow for two connected automation tracks:
- Jira -> n8n -> TestRail test case creation
- TestRail case IDs -> Vibium reproduction -> Playwright test generation and execution

## Quick Start (Happy Path)

If you already have TestRail case IDs, run:
- [.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md](.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md)

Input one mode:
- `caseIds: [C12345, C12346]`
- `sourceInteractionRef: <prior interaction containing case IDs>`

Per case, the agent does:
1) `get_case` (TestRail MCP)
2) Reproduce steps (Vibium MCP)
3) Generate/update POM files in `src/pages`
4) Generate/update spec in `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`
5) Run generated test
6) Continue to next case and report summary

---

## Repository Purpose and Architecture

### What is automated
- **Case creation pipeline**: Jira ID is sent to n8n, response is stored locally, agent parses and creates TestRail cases.
- **Case-to-test pipeline**: Existing TestRail case IDs are fetched, reproduced via Vibium, converted to Playwright POM tests, and executed.

### Core runtime components
- CLI entrypoint: [src/jira-to-testrail/cli.js](src/jira-to-testrail/cli.js)
- Orchestration: [src/jira-to-testrail/index.js](src/jira-to-testrail/index.js)
- n8n client: [src/jira-to-testrail/n8n/n8nClient.js](src/jira-to-testrail/n8n/n8nClient.js)
- TestRail MCP adapter: [src/jira-to-testrail/testrail/testrailMcpClient.js](src/jira-to-testrail/testrail/testrailMcpClient.js)
- Defaults/constants: [src/jira-to-testrail/types.js](src/jira-to-testrail/types.js)
- Playwright baseline config: [playwright.config.ts](playwright.config.ts)
- Smoke test: [tests/smoke.spec.ts](tests/smoke.spec.ts)

---

## Prompt and Agent System

This repo uses `.github/prompts` as the operational source of prompt files.

### Prompt catalog (execution order)
1. **Scaffold / reset baseline** (optional)
  - [.github/prompts/01-start-project.prompt.md](.github/prompts/01-start-project.prompt.md)
  - Agent: Built-in default (no custom agent selection)

2. **Jira -> n8n -> TestRail** (optional, when IDs are not yet available)
  - [.github/prompts/02-jira-testrail-rpi.prompt.md](.github/prompts/02-jira-testrail-rpi.prompt.md)
  - Agent: [.github/agents/jira-testrail.agent.md](.github/agents/jira-testrail.agent.md)

3. **Batch TestRail IDs -> Vibium -> Playwright** (main generation flow)
  - [.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md](.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md)
  - Agent: [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)

4. **Single-case debug loop**
  - [.github/prompts/03-testrail-single-case-debug.prompt.md](.github/prompts/03-testrail-single-case-debug.prompt.md)
  - Agent: [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)

### Agent catalog
- Jira response -> TestRail case creator:
  - [.github/agents/jira-testrail.agent.md](.github/agents/jira-testrail.agent.md)
- TestRail -> Vibium -> Playwright orchestrator:
  - [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)
- TestRail case normalization specialist:
  - [.github/agents/testrail-case-fetcher.agent.md](.github/agents/testrail-case-fetcher.agent.md)
- Playwright POM author/executor:
  - [.github/agents/playwright-author.agent.md](.github/agents/playwright-author.agent.md)

---

## RPI Source of Truth

### Jira -> TestRail RPI
- [docs/rpi/01-research.md](docs/rpi/01-research.md)
- [docs/rpi/02-plan.md](docs/rpi/02-plan.md)
- [docs/rpi/03-implement.md](docs/rpi/03-implement.md)

### TestRail -> Vibium -> Playwright RPI
- [docs/rpi/04-agent-workflow-constraints.md](docs/rpi/04-agent-workflow-constraints.md)
- [docs/rpi/05-playwright-generation-conventions.md](docs/rpi/05-playwright-generation-conventions.md)

### Meta generator prompt (historical)
- [docs/rpi/start-implementation.md](docs/rpi/start-implementation.md)

---

## Operator Runbooks

### Runbook A — Start from Jira and finish with generated Playwright tests

### Step 1 (optional): Initialize workspace baseline
Prompt:
- [.github/prompts/01-start-project.prompt.md](.github/prompts/01-start-project.prompt.md)
Agent:
- Built-in default (no custom agent selection)

### Step 2: Generate TestRail cases from Jira
Prompt:
- [.github/prompts/02-jira-testrail-rpi.prompt.md](.github/prompts/02-jira-testrail-rpi.prompt.md)
Agent:
- [.github/agents/jira-testrail.agent.md](.github/agents/jira-testrail.agent.md)

Input example:
```text
Jira ID: QAT-114
```

CLI used by this flow:
```bash
npm run jira:testrail -- --jira-id QAT-114
```

Hardening rules for this step:
- Run the CLI first for the active Jira ID before listing/reading previous response directories.
- Use only the freshly generated `response.txt` from the current run for parsing and case creation.
- Exclude appendix content (`Coverage Map`, `Open Questions`, `Assumptions`) from case payload generation.
- Use strict `add_case` payload allowlist only: `section_id`, `title`, `type_id`, `refs`, `custom_steps_separated`.
- Always set `refs` to Jira ID only (for example `QAT-114`), never AC/FR tokens.
- On add-case timeout/ambiguous transport failures, perform verify-before-retry idempotency and mark unresolved as `timeout_unconfirmed`.
- Do not log full raw n8n/TestRail payloads; log counts/IDs/file paths only.

Output artifact:
- `data/n8n/{JIRA_ID}/{timestamp}/response.txt`

### Step 3: Generate and run Playwright tests from created case IDs
Prompt:
- [.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md](.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md)
Agent:
- [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)

Input mode A (manual list):
```text
caseIds: [C12345, C12346, C12347]
```

Input mode B (from prior interaction):
```text
sourceInteractionRef: <reference containing case IDs>
```

Expected outputs:
- Updated/created page objects under `src/pages`
- Generated specs under `tests/generated`
- Per-case execution results and batch totals

### Step 4: Fix any failed case one-by-one
Prompt:
- [.github/prompts/03-testrail-single-case-debug.prompt.md](.github/prompts/03-testrail-single-case-debug.prompt.md)
Agent:
- [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)

Input example:
```text
caseId: C12346
```

---

### Runbook B — Start directly from existing TestRail case IDs

1) Run [.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md](.github/prompts/04-testrail-vibium-playwright-rpi.prompt.md)
  - Agent: [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)
2) Pass `caseIds` or `sourceInteractionRef`
3) Review generated assets in `src/pages` and `tests/generated`
4) Re-run failures with [.github/prompts/03-testrail-single-case-debug.prompt.md](.github/prompts/03-testrail-single-case-debug.prompt.md)
  - Agent: [.github/agents/testrail-vibium-playwright.agent.md](.github/agents/testrail-vibium-playwright.agent.md)

---

## Commands and Execution

### Package scripts
From [package.json](package.json):
- `npm run jira:testrail -- --jira-id <JIRA_ID>`
- `npm run platform:dev`
- `npm run platform:build`
- `npm run platform:start`
- `npm run platform:worker`
- `npm test`
- `npm run test:ui`
- `npm run test:report`
- `npm run test:debug`

### Copilot SDK platform app
- Path: `apps/copilot-platform`
- Stack: Next.js + React + Tailwind + TypeScript + Copilot SDK package integration
- Main API: `POST /api/jobs` and `GET /api/jobs`
  - `generate_test_cases` payload: `{ "type": "generate_test_cases", "jiraId": "QAT-114" }`
  - `generate_automation` payload: `{ "type": "generate_automation", "caseIds": ["C12345"] }`
- Current implementation status:
  - Reuses existing CLI Jira -> n8n flow via bridge
  - Creates TestRail cases through API when credentials are configured (fallback mapping otherwise)
  - Provides automation job orchestration with execution metrics/evidence indexing
  - Executes workflow prompts directly through authenticated Copilot SDK sessions
  - Persists job/event history to SQLite (`data/platform/jobs.db`)
  - Streams live job updates through `/api/jobs/stream`
  - Processes queued jobs through a dedicated worker process (`platform:worker`)

### Validate a generated case spec manually
```bash
npx playwright test tests/generated/<case-id>.spec.ts
```

---

## Configuration and Defaults

The CLI can use environment variables, with defaults in [src/jira-to-testrail/types.js](src/jira-to-testrail/types.js):
- `N8N_WEBHOOK_URL` (default webhook is preconfigured)
- `N8N_OUTPUT_DIR` (default `data/n8n`)
- `TESTRAIL_SECTION_ID` (used when section MCP tools are unavailable)
- `TESTRAIL_TYPE_ID` (used for `type_id` on case creation)

Playwright generation/test execution uses:
- `BASE_URL` (required target host for generated Playwright navigation in TestRail->Playwright flows)

Other values (project/section/template/type label defaults) are currently hardcoded via `DEFAULTS` in `types.js`.

PowerShell/Windows environment access:
- Resolve `.env` values using `Get-Item Env:<KEY>` style access when running in PowerShell.
- Recommended keys for Jira->TestRail flow:
  - `TESTRAIL_SECTION_ID`
  - `TESTRAIL_TYPE_ID`
  - `TESTRAIL_TEMPLATE_ID` (if required by MCP/tool schema)

---

## Data and Output Locations

- n8n raw text responses:
  - `data/n8n/{JIRA_ID}/{timestamp}/response.txt`
- Playwright reports:
  - `playwright-report/`
- Playwright run artifacts:
  - `test-results/`
- Generated tests (new flow):
  - `tests/generated/`
- Generated/updated page objects:
  - `src/pages/`

---

## Reliability and Behavior Notes

- CLI validates Jira IDs with format like `ABC-123`.
- n8n client uses timeout + retry/backoff.
- For Jira->TestRail flow, CLI saves the response file; case creation is agent-driven via MCP.
- For TestRail->Playwright flow, execution policy is continue-on-failure per case list.
- If TestRail retrieval MCP tools are unavailable, prompts/agents stop with a missing-tools report.
- If Vibium MCP tools are unavailable, prompts/agents fallback to Playwright-only reproduction and continue reporting per-case outcomes.

---

## Supporting Indexes

- Prompt index: [prompts/README.md](prompts/README.md)
- Workflow notes: [workflows/README.md](workflows/README.md)
- RPI index: [docs/rpi/README.md](docs/rpi/README.md)

---

## Contribution Rule for Prompt Changes

When changing prompts:
1) Update `.github/prompts/*`
2) Keep this README sequence accurate
3) Ensure referenced RPI docs still match actual behavior
