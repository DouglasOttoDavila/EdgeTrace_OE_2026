# .prompt.md — Jira to TestRail (RPI)
# Mode: Agent Mode (Copilot)
# Goal: Parse the already-generated n8n response and create/reconcile TestRail cases using MCP tools only.

## SOURCE OF TRUTH
Use these files as authoritative requirements:
- docs/rpi/01-research.md
- docs/rpi/02-plan.md
- docs/rpi/03-implement.md

## TASK
1) Read the RPI docs above and verify implementation expectations.
2) Use the platform-provided input values:
    - Jira ID
    - Platform n8n response path
3) Read the provided n8n response file and extract candidate test cases.
4) Create/reconcile TestRail cases using MCP tools only.
    - Do NOT run CLI commands.
    - Do NOT call n8n.
    - Do NOT use SDK-defined local function tools.
    - Always set `refs` to Jira ID only.
5) Return a strict machine-readable result as JSON so the platform can persist `generatedCases` and `caseIds`.

## PARSING + PAYLOAD HARDENING RULES
- Parse only case payload content and exclude appendix content that starts at top-level headings such as `Coverage Map`, `Open Questions`, or `Assumptions`.
- For heading detection, treat headings as top-level only when they begin at column 0; do not break step parsing on indented `Expected Results:` lines.
- Normalize add-case payloads using a strict allowlist. Allowed fields for create are:
   - `section_id`
   - `title`
   - `type_id`
   - `refs`
   - `custom_steps_separated`
- Remove/ignore unsupported fields before sending the request.

## DEDUPE + CREATE RULES
- Apply idempotency with key: `section_id` + exact `title` + exact `refs`.
- Before create, check if case exists by this key:
   - if found, reuse its ID and mark status `existing`.
- On create attempt:
   - on success, mark status `created`.
   - on ambiguous failure/timeout, re-check by the same key:
      - if found, mark status `existing_after_error`.
      - if not found, mark status `failed` and `failureReason: timeout_unconfirmed`.
- Use bounded retries (max 2, exponential backoff) for create attempts.

## ENV RESOLUTION RULES
- Resolve TestRail defaults from environment when available:
   - `TESTRAIL_SECTION_ID`
   - `TESTRAIL_TYPE_ID`
   - `TESTRAIL_TEMPLATE_ID` (if required)
- If env values are unavailable, still proceed using values inferred from the case payload or report failure per case.

## OUTPUT CONTRACT (STRICT)
Return JSON only (no prose before/after). This exact top-level shape is required:

```json
{
   "jiraId": "QAT-114",
   "generatedCases": [
      {
         "sourceIndex": 1,
         "title": "Case title",
         "refs": "QAT-114",
         "sectionId": 1621,
         "typeId": 6,
         "preconditions": "optional",
         "steps": [
            { "step": "Do action", "expectedResults": "Expected result" }
         ],
         "testrailCaseId": "C12345",
         "status": "created",
         "failureReason": "optional"
      }
   ],
   "summary": {
      "preparedCount": 1,
      "createdCount": 1,
      "failedCount": 0
   }
}
```

`status` allowed values:
- `created`
- `existing`
- `existing_after_error`
- `failed`

## EXECUTION RULES
- Do not log secrets or full raw credentials.
- Use MCP tools only for TestRail operations.
- If MCP tool names are unknown, enumerate available TestRail MCP tools and choose the correct ones.
- Preserve deterministic output order by `sourceIndex`.
