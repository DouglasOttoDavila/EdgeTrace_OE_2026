# Playwright Generation Conventions

## Scope
This document defines required conventions when generating Playwright tests from TestRail cases.

## File Layout
- Generated specs: `tests/generated/{case-id}-{readable-kebab-title}.spec.ts`
- Page objects: `src/pages/*.page.ts`

## POM Requirement
- Page Object Model is mandatory for generated tests.
- Generated spec files must not contain large inline locator/action blocks that belong in page objects.
- If a page object does not exist, create one.
- If one exists, extend it instead of duplicating behavior.
- POM usage must not replace proper case-specific spec authoring.
- Do not generate abstraction-only test runners that replay text steps from data structures (for example: `caseRunner`, `runGeneratedCase`, or equivalent pattern).
- Each generated spec must explicitly represent the target case flow and assertions using standard Playwright test structure.

## Generated Spec Structure (Required)
- Include `test.describe` context for the case.
- Include at least one test with title beginning `[C{case-id}]`.
- Use explicit, deterministic actions and assertions mapped from the case steps.
- Reuse page object methods for UI actions/selectors, not for hiding all test intent.

## Locator Strategy
Use this priority order:
1. `getByRole`
2. `getByLabel`
3. `getByPlaceholder`
4. `getByText` (exact or constrained)
5. CSS selector fallback only when necessary

Avoid brittle selectors based on deeply nested DOM structure.

Responsive and duplicate-match rules:
- When a locator has multiple matches, select the first **visible** match, not blindly `.first()`.
- For navigation controls that may render as either link or button across breakpoints, support both variants.
- Prefer deterministic helper methods in page objects (e.g., `clickFirstVisible`) over ad-hoc inline selector retries.
- If a menu must be opened before a target option appears, model that as explicit POM steps before assertions.

Vibium compatibility rules for reproduction:
- Prefer plain CSS selectors when using Vibium interaction tools.
- Do not assume Playwright-only selector patterns (for example `:has-text(...)`) are supported in Vibium selectors.
- If selector syntax fails in Vibium, discover with broad CSS + evaluate filtering, then continue verification in Playwright.

Click reliability fallback (Vibium -> Playwright):
- If Vibium click fails due to event interception:
  1. scroll into view,
  2. hover,
  3. retry click once,
  4. if still blocked, use evaluate click only for diagnostic navigation confirmation,
  5. assert behavior definitively in Playwright run.

Popup/new-tab assertion rules:
- For CTA interactions, generated tests must support both outcomes:
  - popup/new-tab opened, or
  - same-tab navigation.
- Use deterministic popup wait with fallback URL assertion in the current page.

## Assertion Strategy
- Assert at meaningful checkpoints tied to expected outcomes.
- Keep assertions focused and stable.
- On final step, assert the core success condition from the case.

## Test Naming
- `test.describe` title includes the case ID context.
- Each test title starts with `[Cxxxx]` where `xxxx` is the numeric TestRail case ID.

Example:
- `[C12345] User can submit contact form`

## Test Data + State
- Prefer deterministic inline fixtures in the test file for now.
- Do not introduce new global fixtures unless needed by multiple generated tests.
- Keep each generated case independently runnable.

## Execution
- Run each generated test immediately after writing:
  - `npx playwright test tests/generated/{case-id}-{readable-kebab-title}.spec.ts`
- Capture pass/fail and first actionable error for reporting.

## Base URL Configuration
- The automation runtime must use `BASE_URL` from `.env` via Playwright config (`process.env.BASE_URL`).
- Generated specs and page objects should navigate with relative paths (for example `page.goto('/')`), relying on configured `baseURL`.
- Do not hardcode absolute hostnames (for example `http://localhost:3000`) in generated tests.
- If `BASE_URL` is missing, report a clear configuration failure and required next action.
- During reproduction, verify the active Vibium target host resolves from the same `BASE_URL` value before interaction begins.

## Error Handling
- If generation succeeds but execution fails, keep files and mark case `failed` with reason.
- If a case cannot be translated (missing steps/context), create a minimal pending spec and mark `skipped` with rationale.
- Keep failure reporting payload-safe: include IDs and concise reasons, not full raw external payload dumps.

## Style Alignment
- Follow existing repo TypeScript/Playwright style.
- Keep changes minimal and case-focused.
- Do not refactor unrelated tests while generating per-case assets.
