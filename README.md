# EdgeTrace

**From Jira intent to executed automation evidence, without handoffs.**

EdgeTrace is an AI-first quality engineering platform that transforms requirements into test intelligence and working automation. It combines **n8n workflow orchestration**, **Copilot SDK-driven agents**, **TestRail synchronization**, and **Playwright execution** into one continuous, production-minded pipeline.

## Why EdgeTrace

Traditional QA pipelines break at every boundary: requirements, test design, automation, execution, and reporting. EdgeTrace compresses that chain into one workflow so teams move from "ticket ready" to "test evidence ready" with minimal manual coordination.

## Core Value

- Converts Jira scope into structured test cases and syncs them to TestRail.
- Converts TestRail cases into generated Playwright automation (POM-based).
- Executes generated tests and captures authoritative evidence (screenshots, videos, traces, reports).
- Streams job progress and stores outcomes in a persistent job timeline.
- Keeps the process deterministic, repeatable, and scalable.

## How It Works End-to-End

### Flow 1: Jira -> n8n -> Copilot SDK -> TestRail

1. A job is started with `generate_test_cases` and a Jira ID.
2. EdgeTrace calls **n8n** (legacy bridge) to ingest/analyze Jira content and stores the response in `data/n8n/.../response.txt`.
3. Copilot SDK workflow parses that response and creates/reconciles TestRail cases through MCP tools.
4. Generated case IDs are persisted and exposed in the platform UI/API.

### Flow 2: TestRail -> Real Browser Reproduction -> Playwright Generation -> Execution

1. A job is started with `generate_automation` and TestRail case IDs.
2. EdgeTrace fetches case details from TestRail.
3. It performs **real browser reproduction** of case behavior first (Vibium MCP when enabled, with fallback strategy).
4. Only then does it generate/update Playwright POM assets in:
   - `src/pages`
   - `tests/generated`
5. The generated specs are executed automatically with Playwright.
6. EdgeTrace collects metrics and artifacts, persists them, and exposes them in the dashboard.

## Real Browsing First, Code Second

EdgeTrace does not blindly generate scripts from static text. It reproduces behaviors in a live browser context before finalizing automation code, then executes the generated Playwright tests as the authoritative validation run. This improves realism, selector quality, and confidence in generated automation.

## n8n + Copilot SDK Integration Strategy

EdgeTrace intentionally keeps **n8n ingestion** and **Copilot orchestration** as distinct responsibilities in this phase to demonstrate explicit n8n integration capability.

Yes, this can be consolidated: the n8n-facing responsibility could also be absorbed into the Copilot SDK workflow layer. It was intentionally separated here to make the integration boundary visible and operational.

## Automation Is the Default

Once a job is triggered, the remaining lifecycle is automatic:

- ingest
- parse
- sync
- generate
- execute
- collect evidence
- publish job timeline/results

## Platform Components

- **UI Console (Next.js):** live workflow dashboard (`apps/copilot-platform`).
- **Worker:** queue polling + background execution (`platform:worker`).
- **Copilot SDK Orchestrator:** prompt-driven workflow execution with MCP servers.
- **n8n Bridge:** Jira ingestion and response persistence.
- **TestRail Integration:** case retrieval + synchronization.
- **Playwright Runtime:** generated test execution and report generation.
- **SQLite Job Store:** persistent job/events history (`data/platform/jobs.db`).

## Quick Start

```bash
npm install
npm --prefix apps/copilot-platform install
npm run platform:dev
npm run platform:worker
```

Open `http://localhost:3000` and trigger:

- `generate_test_cases` with Jira ID
- `generate_automation` with case IDs

## API Trigger Examples

```http
POST /api/jobs
Content-Type: application/json

{ "type": "generate_test_cases", "jiraId": "WORKSHOP26-1" }
```

```http
POST /api/jobs
Content-Type: application/json

{ "type": "generate_automation", "caseIds": ["C11250"] }
```

## Output & Evidence

- n8n responses: `data/n8n/{JIRA_ID}/{timestamp}/response.txt`
- generated specs: `tests/generated`
- page objects: `src/pages`
- test run output: `test-results`
- reports: `playwright-report`
- persisted artifacts: `data/platform/artifacts/{jobId}`

## Next-Level Enhancement: Jira Webhook Auto-Trigger

EdgeTrace can be extended to fully event-driven QA orchestration via webhook.

Example:

1. Jira issue transitions to **Ready for QA**.
2. Jira webhook calls EdgeTrace API.
3. EdgeTrace auto-runs the full chain:
   - test case generation
   - TestRail sync
   - automation generation
   - execution
   - evidence/report publication

That enables true zero-touch QA activation from workflow state changes.

## EdgeTrace in One Line

**EdgeTrace turns QA from a sequence of manual handoffs into a single intelligent, automatic execution pipeline.**
