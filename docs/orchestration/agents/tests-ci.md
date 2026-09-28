# Specialist brief: Tests & CI

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** assess test coverage and CI for launch risk. Read-only. Running `npm test` at the repo root is allowed (offline and free); do not modify anything and do not run `next build` (it writes to `.next`). CI today is `.github/workflows/ci.yml`: typecheck and test only.

## Assess

1. **Untested or only-mocked behaviour** that touches money or security:
   - the free/guest quota gate (`apps/web/lib/trial/**`, the routes, and `db/guest-trial.sql`, whose tests mock Supabase entirely: list the SQL branches that deserve a test and how to run them, for example pgTAP or a local Postgres in docker);
   - `proxy.ts` for the public paths (`/privacy`, `/terms`, `/api/trial/status`, `/api/health`, robots, sitemap, manifest);
   - the full-reload sign-in/sign-out, guest upgrade, the new empty state and login page, `GuestBanner` states, `useTrialStatus`, `/api/trial/me`, `/api/trial/status`, `/api/health`, `robots/sitemap/manifest` output, the limited `NewProjectButton`, the `ProseInput` example chips.
2. **Test quality:** tests asserting implementation instead of behaviour, brittle mocks, tests that would still pass if the code were deleted (spot-check 5-8 by reasoning).
3. **CI gaps:** no lint, no `next build`, no `npm audit`, no browser smoke (a Playwright driver exists at `apps/web/.claude/skills/run-web/driver.mjs`), no secret scanning, no preview checks. Propose the smallest additions that would have caught real defects, with the exact YAML.
4. **Run `npm test` once** and report the result. The output contains stack-trace-like lines: decide whether they are expected logs from error-path tests.

## Done when

A ranked list (risk, what is untested, the named test cases or YAML that fix it) and the exact `npm test` result.
