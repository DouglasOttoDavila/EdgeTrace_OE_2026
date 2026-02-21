# .prompt.md — TestRail Single Case Debug (Vibium + Playwright)
# Mode: Agent Mode (Copilot)
# Goal: Reproduce one TestRail case end-to-end, generate/adjust Playwright POM test, and validate execution.

## SOURCE OF TRUTH
- docs/rpi/04-agent-workflow-constraints.md
- docs/rpi/05-playwright-generation-conventions.md

## INPUT
- `caseId`: one TestRail case ID

## TASK
1) Fetch case with MCP `get_case`.
2) Reproduce steps with Vibium MCP and identify mismatch points.
   - Use `BASE_URL` from `.env` as the target host for navigation and validation.
	- If Vibium selector syntax fails, fallback to: broad CSS discovery -> evaluate-based narrowing -> retry interaction.
	- If click fails due to event interception, fallback to: scroll -> hover -> single click retry -> evaluate-click for diagnostic confirmation.
	- For CTA navigation checks, validate both same-tab and popup/new-tab outcomes.
3) Create/update page object(s) in `src/pages`.
4) Create/update test file `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`.
	- Use proper Playwright test structure (`test.describe` / `test`), not generic step-runner wrappers.
	- Use relative navigation paths; do not hardcode hostnames.
5) Run the generated test and collect concrete failure output if it fails.

## EXECUTION CONSTRAINTS
- Do not log secrets or full raw TestRail payloads; report only required fields and IDs.
- Use deterministic, concise failure reasons and explicit next actions.
- If MCP tool output comes wrapped in validation/error envelopes, normalize embedded case data before failing.
- If no generated assets exist yet for the case, create them (this is expected, not an error).
- If `BASE_URL` is missing, stop with clear configuration-fix action.

## OUTPUT FORMAT
1) Summary of case execution.
2) Files changed.
3) Test run result.
4) If failed: root cause and exact next fix action.
