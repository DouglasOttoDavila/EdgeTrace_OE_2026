# .prompt.md — TestRail Case IDs -> Vibium Repro -> Playwright (RPI)
# Mode: Agent Mode (Copilot)
# Goal: For each TestRail case ID, fetch case details, reproduce with Vibium, generate Playwright POM test, run it, then continue.

## SOURCE OF TRUTH
Use these files as authoritative requirements:
- docs/rpi/04-agent-workflow-constraints.md
- docs/rpi/05-playwright-generation-conventions.md

## INPUT MODES
Provide one of:
- `caseIds`: manually entered list of TestRail case IDs
- `sourceInteractionRef`: previous interaction reference that contains generated case IDs

If both are provided, use `caseIds`.

## TASK
1) Resolve the case ID list in original order.
2) For each case ID:
   - Call TestRail MCP `get_case`.
   - Normalize context and executable steps.
   - Use Vibium MCP to navigate and reproduce steps on the target page.
   - If Vibium MCP tools are unavailable, blocked by permissions/sandbox, or fail to launch browser, fallback to Playwright MCP/browser-based reproduction and continue processing.
   - Generate/update Playwright page objects under `src/pages`.
   - Generate/update `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`.
   - Generate proper Playwright specs (standard `test.describe` / `test` format), not generic shared step-runner wrappers.
   - Run the generated test immediately.
   - Record status and continue to next ID even if current case fails.
3) Return a final batch summary with per-case outputs.

## EXECUTION RULES
- You MUST perform tool actions and command execution directly; do not ask user to run commands.
- Continue-on-failure is default and mandatory unless user explicitly overrides.
- Do not log secrets or copy full raw payloads in output.
- Keep generated code aligned with repository style and POM conventions.
- Use MCP tools only; do not rely on SDK-defined local function tools.
- Use `BASE_URL` from `.env` for navigation target host; avoid hardcoded hosts in generated code.
- For responsive UI states, selectors must handle link/button variants and avoid blind `.first()` on role locators when hidden duplicates are possible.
- If Vibium MCP fails due local browser/sandbox permissions, do not stop batch; switch to Playwright MCP and record fallback in case result.
- If running in fallback mode, include `evidenceSource: playwright-fallback` in the case result.
- If MCP responses are wrapped in validation/error envelopes, normalize embedded data before reporting missing/failed cases.
- Report concise, structured outputs with IDs/counts only; avoid raw payload dumps.

## OUTPUT FORMAT
1) Short summary.
2) Case-by-case result list: case ID, title, generated files, run status, failure reason if any.
3) Aggregate totals: passed/failed/skipped.
4) Next step suggestion.
