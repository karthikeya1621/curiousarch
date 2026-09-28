# Specialist brief: Correctness & reliability

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** find real bugs and reliability gaps a user would hit. Read-only; no paid calls; never print secrets.

Focus on what was written most recently and never tested in a real browser.

## Review at least

- **Trial gate:** `apps/web/lib/trial/**` and its use in `app/api/{infer,rework,chat,identify-failures,explain-fix,usage/outcome}/route.ts`: reserve/release ordering, a retry with the same `actionId`, release on failure, races, the AI call succeeding but the client never receiving the result, `after()`-scheduled usage writes vs budget counting.
- **SQL logic:** `db/guest-trial.sql` (`trial_reserve`, `purge_anonymous_users`): CTE semantics for the unreferenced data-modifying CTEs, advisory-lock scope, unique-constraint edge cases, guest → signed-in upgrade with quota already used, `is_guest` accounting.
- **Auth flows:** `app/login/page.tsx`, `components/AccountMenu.tsx`, `components/GuestBanner.tsx` (email upgrade via `updateUser` and `/auth/callback`), stale in-memory state across accounts (`lib/store/session.ts`).
- **Store:** `apps/web/lib/store/**`: autosave, project switching, in-flight request epochs, error paths, what a failed save does to the UI.
- **Server limits:** missing `maxDuration` / runtime config for long AI routes; missing `error.tsx`, `global-error.tsx`, `not-found.tsx`; client `fetch(...).json()` calls that assume JSON when a host returns an HTML 502/504.
- **Engine:** `packages/engine/src/inference/*`: timeouts, retries, the `ModelGateError` path, partial failures, what a caller sees when every retry fails.

## Done when

A ranked list of verified bugs, each with the triggering scenario and minimal fix, plus the areas found sound.
