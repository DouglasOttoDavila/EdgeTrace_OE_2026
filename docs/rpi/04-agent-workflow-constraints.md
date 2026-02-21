# Agent Workflow Constraints — TestRail -> Vibium -> Playwright

## Goal
Define the mandatory execution contract for generating and validating Playwright tests from existing TestRail case IDs.

Cross-flow alignment note:
- For Jira -> n8n -> TestRail reliability controls (fresh CLI-first execution, payload allowlist safety, idempotent retries, Jira-only refs, and safe logging), follow:
   - [01-research.md](01-research.md)
   - [02-plan.md](02-plan.md)
   - [03-implement.md](03-implement.md)

## Accepted Inputs
- `caseIds`: explicit list of TestRail case IDs (manual entry).
- `sourceInteractionRef`: reference to a previous interaction output that already contains generated case IDs.

If both are provided, `caseIds` takes precedence.

## Required Per-Case Loop
For each case ID, execute in order:
1. Fetch TestRail case details using MCP `get_case`.
2. Normalize the case into a canonical execution model:
   - `title`
   - `preconditions`
   - `steps[]` with `action`, `expected`
   - `priority` and relevant metadata
3. Reproduce the scenario with Vibium MCP tools:
   - navigate to target URL
   - perform interactions required by the case steps (click/type/select/assert)
   - capture screenshots on meaningful checkpoints and on failure
4. Generate or update Playwright assets following repository conventions:
   - create/update page objects in `src/pages`
   - create/update a self-contained spec file in `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`
5. Run the generated test to verify the script executes.
6. Persist a per-case result record and continue to the next case.

## Playwright Spec Authoring Contract
- Generated specs must be proper Playwright test files (`test.describe`, `test`, `test.step` as needed).
- Each spec must be understandable and runnable on its own for the target case.
- Do not generate generic shared step runners that execute free-form text steps (for example: `caseRunner`, `runGeneratedCase`, or similar abstraction-only wrappers).
- Use page objects for reusable UI actions, but keep case intent explicit in each spec.

## Continuation Policy
- Default mode is continue-on-failure.
- A failed case must not block processing remaining case IDs.
- Final output must include passed/failed/skipped counts and case-level reasons.

## Output Contract
At completion, return:
- Execution summary (`total`, `passed`, `failed`, `skipped`)
- Per-case results containing:
  - case ID
  - generated files
  - execution status
  - concise failure reason (if any)
  - evidence references (screenshots/logs)

## Safety + Reliability Rules
- Do not log secrets, session tokens, or private payloads.
- Do not copy full TestRail raw payloads into output; include only required fields.
- Avoid brittle selectors; prefer role/label/text strategies before CSS fallback.
- Keep retries minimal and deterministic.
- Use `BASE_URL` from `.env` for browser navigation in Playwright flows; do not hardcode hosts in generated assets.

## Known Failure Modes + Required Fallbacks

1) Vibium selector syntax mismatch
- Prefer plain CSS selectors for Vibium interaction tools.
- Do not assume Playwright-only selector syntax (for example `:has-text(...)`) is supported by Vibium.
- Fallback sequence:
   1. discover candidates with `find_all` using broad CSS,
   2. narrow by text/href via browser evaluate,
   3. interact with the resolved CSS selector,
   4. if unresolved, continue with Playwright-based reproduction and report `selector_syntax_mismatch`.

2) Vibium click fails with event interception (for example `ReceivesEvents`)
- Fallback sequence:
   1. `scroll` target into view,
   2. `hover` target,
   3. retry `click` once,
   4. if still blocked, perform evaluate-based click only to confirm intended destination,
   5. validate behavior in generated Playwright test as source of truth for pass/fail.
- Report this as a deterministic mismatch note, not an immediate case failure.

3) Popup/new-tab inconsistency during Vibium reproduction
- After CTA click, always verify both possibilities:
   - same-tab navigation via current URL, and
   - new-tab navigation via tab listing/switch.
- If tab targeting appears stale in Vibium, confirm destination with URL inventory and proceed with Playwright popup-handling assertions.

4) Host hardcoding risk
- Mandatory preflight: verify `BASE_URL` exists before reproduction/generation.
- Generated specs/page objects must use relative navigation paths and rely on Playwright `baseURL`.
- If `BASE_URL` is missing, stop execution with `missing_base_url_configuration` and explicit next action.

5) No existing generated assets for a case
- This is expected for first-time case execution.
- Agent must create missing page object/spec files instead of failing.
- Mark outcome as normal generation, not as defect.

## MCP Tool Availability
Use this fallback matrix when MCP tools are unavailable:

- If TestRail case retrieval tools are unavailable (no `get_case` support):
   - Stop execution.
   - Return a clear missing-tools report.

- If Vibium browser session/navigation/interaction tools are unavailable:
   - Do not stop the batch.
   - Fallback to Playwright-only reproduction for the case.
   - Continue-on-failure remains mandatory.
   - Label evidence source as `playwright-fallback` in per-case results.

- If both categories are unavailable:
   - Stop execution and return missing-tools report.

Minimum required availability:
- TestRail `get_case` support is mandatory.
- Vibium support is optional only when fallback is available.

## Naming Conventions
- Generated spec path: `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`
- Generated page objects: `src/pages/{feature-or-page}.page.ts`

Filename rules for generated specs:
- Keep the numeric TestRail case ID first.
- Add a readable kebab-case title segment derived from the case title.
- Remove unsafe filename characters.
- Example: `tests/generated/11119-verify-page-access-load-via-navigation.spec.ts`

## Batch Determinism
- Process IDs in the exact provided order.
- Do not silently reorder or deduplicate unless instructed.
- If a duplicate ID exists, process each occurrence and report duplicates.
