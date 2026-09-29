# Correctness & reliability specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46. Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message.

**Correctness & reliability findings, ranked (CuriousArch, read-only review)**

Severity uses critical/high/medium/low. Every item is confirmed by reading code unless it says "plausible". No commands were run, and no files were edited or created.

**1. [HIGH] apps/web/app/api/usage/outcome/route.ts:37 + apps/web/lib/trial/server.ts:88-93 + db/guest-trial.sql:110-114 - Any guest can refund their own quota with one POST.**
- Scenario: A guest builds, then calls `POST /api/usage/outcome {actionId:<their build id>, reason:"withheld"}`. `trial_release` sets `released_at` on every kind for that action id, and the client picks the id. The build slot is free again, so the guest gets unlimited builds and Re-simulates. `trial_budget_open` is only checked when a guest account is first created, so an existing guest is never stopped by the budget.
- Fix: Drop the client-driven release. Or restrict it to `kind='rework'` and allow at most one client-driven release per account (a counter column checked in SQL). The 422 gate path already releases server-side via the routes' `catch` blocks.
- Confidence: confirmed by reading code.

**2. [HIGH] db/guest-trial.sql:110-114 + app/api/identify-failures/route.ts:37 - A failed findings call also refunds the build or Re-simulate it belongs to.**
- Scenario: `ProseInput.tsx:45,59` and `ResimulateButton.tsx:51,78` pass one `actionId` into both `/api/infer` (or rework) and the follow-up `/api/identify-failures`. If findings fails (Anthropic 5xx, timeout, or validation exhausted), the route calls `gate.release()`, which releases both the `findings` row and the `build`/`rework` row. The user keeps the built model but gets the build back for free, and a later `needs-build` check can flip the wrong way.
- Fix: Add `p_kind` to `trial_release` and release only the route's own kind (`app/api/*/route.ts` catch blocks and `releaseTrialAction`).
- Confidence: confirmed by reading code.

**3. [HIGH] apps/web/components/FailureSidebar.tsx:51-56, apps/web/lib/store/findings.ts:100-105, apps/web/components/NewProjectButton.tsx:34 - A findings failure leaves the user in a dead end.**
- Scenario: A build succeeds and the findings call fails. `findingsError` is stored, saved with the project, and shown as "please try again in a moment", but nothing on screen retries findings. `refreshFindings` is only called from `setModel` and `commitRework`. For a limited user, "New project" is disabled. The only way out is to change a tier or queue something and burn the one Re-simulate.
- Fix: Add a "Retry" button in `FailureSidebar` that calls `refreshFindings(set, get)` with a fresh `actionId`. The trial gate then treats it as a normal findings call once #2 is fixed.
- Confidence: confirmed by reading code.

**4. [HIGH, plausible on Vercel] All 5 AI routes under apps/web/app/api/*/route.ts, packages/engine/src/inference/structuredCall.ts:195 - No `maxDuration` and long worst-case durations.**
- Scenario: The build chain has up to about 4 sequential calls (`fromProse.ts:173-204`), and a gate failure doubles it (`fromProse.ts:157-162`). Each request has a 90s timeout, and `new Anthropic` keeps the SDK's default retries. `docs/DEPLOYMENT.md:27` says "up to a minute". If the platform kills the function, `catch` never runs, so the reserved quota is never released and the `after()` usage rows are never written. The client gets an HTML 5xx (now handled) with the slot spent.
- Fix: Add `export const maxDuration = 300;` (documented in `node_modules/next/dist/docs/.../maxDuration.md`) to infer, rework, identify-failures and chat. Set `maxRetries: 0` or 1 on the Anthropic client. Correct the DEPLOYMENT.md note.
- Confidence: plausible. The missing config is confirmed; the plan and function limit are unknown.

**5. [MEDIUM] apps/web/components/ProseInput.tsx:45-59, apps/web/lib/store/slices/modelSlice.ts:96-105 - A slow Build result can overwrite a saved project.**
- Scenario: The blank screen shows `ProjectsCard` (`Workspace.tsx:147-149`). A user clicks Build, opens saved project X while the build is in flight, and the build then lands. `setModel` replaces X's in-memory session but leaves `currentProjectId = X`, and bumps `autosaveRevision`. Autosave then updates X's DB row with the new build. Unlimited users (admins, or trial disabled) are exposed now; limited users are mostly blocked by quota.
- Fix: In `ProseInput.submit`, capture `sequence.epoch` before the fetch. After the response, if it changed, call `reportOutcome(actionId,"project-switched")` and return, as `findings.ts:64` and `chatSlice.ts:89` do.
- Confidence: confirmed by reading code.

**6. [MEDIUM] app/api/usage/outcome/route.ts:37 - Only anonymous users get a refund on a withheld result.**
- Scenario: Signed-in users share the same lifetime quota (`server.ts:35-49`). If they edit during a Re-simulate, the client withholds the result and they still lose the one Re-simulate. The banner then tells them "more with credits".
- Fix: Decide the policy. If refunds stay, drop the `is_anonymous` condition. Any refund must be server-verified or capped (see #1).
- Confidence: confirmed by reading code.

**7. [MEDIUM] apps/web/lib/trial/server.ts:79,92 and app/api/usage/outcome/route.ts:35 - RPC and insert errors are ignored.**
- Scenario: supabase-js returns `{error}` instead of throwing. `trial_release` failures are never caught or logged, so a Supabase blip during a failed AI call silently charges the user's quota. The outcome insert has the same problem.
- Fix: Destructure `{error}` and `console.error` it. Optionally retry once.
- Confidence: confirmed by reading code.

**8. [MEDIUM] apps/web/app - No `error.tsx`, `global-error.tsx`, `not-found.tsx` or `loading.tsx`.**
- Scenario: A render exception in the client-only Workspace (for example a malformed saved project JSON from `sessionToState`/`healSession`) shows Next's bare default error page with no branded recovery. The whole app is one client component tree.
- Fix: Add `app/error.tsx` (with reset), `app/global-error.tsx` (with its own `<html>`/`<body>`) and `app/not-found.tsx`.
- Confidence: confirmed (`find` over `app` returned none).

**9. [MEDIUM] apps/web/app/auth/callback/route.ts:18 - A failed code exchange is silent.**
- Scenario: The result of `exchangeCodeForSession` is ignored. An expired or reused magic link, or a guest-upgrade link opened in a different browser (no PKCE verifier), redirects to `/`, then to `/login`, with no message.
- Fix: Check `error`, and redirect to `/login?error=...` for the login page to display.
- Confidence: confirmed by reading code. The PKCE cross-browser case is plausible.

**10. [MEDIUM] db/guest-trial.sql:24,71-82 - `is_guest` is never updated after a guest upgrades.**
- Scenario: A guest signs up, and `trial_accounts.is_guest` stays true. The upgraded user's spend still counts toward `trial_spend_today`, and their row still counts toward the per-IP account cap. They can trip the daily guest budget and lock other guests out.
- Fix: In `trial_reserve`, when the row exists and `not p_guest`, run `update trial_accounts set is_guest=false where user_id=p_user and is_guest`. Do the same in the `setup-production.sql` copy.
- Confidence: confirmed by reading code.

**11. [LOW] apps/web/lib/sessionStorage.ts:145,158,166 + components/AutoSaveIndicator.tsx:59-63 - Two saves can overlap.**
- Scenario: Two first saves overlap (autosave plus `saveBeforeLeaving`, or a slow insert past the 1.5s debounce). Both insert with the same `draftProjectId`, so the second fails on the primary key and shows "Save failed - retry". Also, `update ... eq(id)` that matches 0 rows (project purged or deleted elsewhere) returns no error and reports "Saved".
- Fix: Serialize saves with a module-level in-flight promise. Use `.select("id")` on the update and treat an empty result as a failure.
- Confidence: plausible for the overlap; confirmed for the 0-row case.

**12. [LOW] apps/web/lib/sessionStorage.ts:20-25,202-205 + lib/store/slices/projectSlice.ts:108-122 - Load errors are treated as "not found".**
- Scenario: `loadProject` returns null for a transient network or DB error. A pointer resume then drops the last-project pointer (`projectSlice.ts:119`). A deep link shows "Project not found" for a project that exists. `currentUserId` is outside the `try`, so a throw leaves `hydrated` false and the page stuck on "Loading your project...".
- Fix: Distinguish error from absence, and wrap `hydrateFromStorage` in try/finally so it always sets `hydrated`.
- Confidence: confirmed for the mapping; plausible for the hang.

**13. [LOW] lib/usage/pricing.ts:79-80, db/guest-trial.sql:44,71-80 - The budget guard can silently stop working.**
- Scenario: Setting `AI_REASONING_MODEL` without `AI_MODEL_PRICES` gives `cost_usd = null`, so `trial_spend_today` stays 0 and the daily budget never trips. `ai_calls` rows are also written under `after()`, so a burst of new guests all pass the check before any spend is recorded. A timed-out function never writes its rows.
- Fix: Fail closed on unpriced models (use a conservative default price), and log a warning.
- Confidence: confirmed by reading code.

**14. [LOW] apps/web/lib/trial/server.ts:32-38 - The gate fails open in two cases.**
- Scenario: `getUser()` returns `{user:null,error}` on a network failure (it does not throw), or `createClient` throws. `reserveTrial` returns `noop`, so a guest gets an ungated AI call. The proxy also calls `getUser` first, so this is unlikely.
- Fix: On error or null user, deny instead of returning `noop`.
- Confidence: plausible.

**15. [LOW] db/guest-trial.sql:72,90 + components/GuestBanner.tsx:26-35 - "Trial used up" shows for reasons that are not quota.**
- Scenario: `explain-fix` on a saved project with no counted build/rework (legacy or pre-launch project) returns `needs-build`. The banner says "You've used the free plan". Any `trial-limit` event, including `unavailable`, `needs-build` and the replay `quota`, gives the same message.
- Fix: Pass the `reason` through the event and show reason-specific copy.
- Confidence: confirmed by reading code.

**16. [LOW] apps/web/components/AccountMenu.tsx:50-58, db/guest-trial.sql:123 - Guest data can be lost without warning.**
- Scenario: Guest "Sign out" abandons the anonymous account and its project with no warning, and `signOut` has no try/catch, so a network failure leaves the menu unresponsive. `purge_anonymous_users` deletes by `created_at` rather than last activity, so a guest at day 30 loses an active project. A guest whose email upgrade is unconfirmed is still `is_anonymous` and gets purged too.
- Fix: Confirm before a guest signs out. Purge on inactivity. Wrap `signOut` in try/catch and always navigate.
- Confidence: confirmed by reading code.

**Checked and sound**
- SQL `trial_reserve`:
  - the per-user advisory lock serializes same-user reserves;
  - the replay check returns `quota` while a use is still counted, and a released row is re-activated correctly;
  - the `(user_id, action_id, kind)` unique key is consistent with the logic;
  - `db/setup-production.sql` matches `guest-trial.sql` for these functions.
- `purge_anonymous_users`: the unreferenced data-modifying CTEs `t1` and `t2` always execute (they reference `gone`), and the projects FK cascades.
- Route ordering: reserve happens before the engine call, and a replay 'quota' denial returns before the `try`, so it is never released.
- Engine failure handling: `upstreamError` hides raw model output and provider text in production. The `ModelGateError` path returns 422 `unsafe-result`, releasing in the catch before `upstreamError` runs.
- Store:
  - the epoch/sequence guards in `findings.ts` and `chatSlice.ts`;
  - the Re-simulate withhold check (`ResimulateButton.tsx:72-77`);
  - last-click-wins in `openProject`;
  - `saveBeforeLeaving`;
  - sign-out and login use full page loads, and `setLastProjectId(null)` is cleared, so no cross-account in-memory state.
- Client `res.json().catch` is applied at all 6 fetch sites.
- `proxy.ts`: the auth gate and matcher are correct. The only unauthenticated API route is `/api/trial/status`, which is intentional.
- `guestTrialOpen` and `/api/trial/me` are safe failures: they show no guest option or no banner, and the server still decides.

**Not checked**
- Live behavior in a browser, and Supabase dashboard settings (anonymous sign-ins, captcha, email-change confirmation flow).
- Vercel plan and function limits.
- Prompt and inference quality.
- Security items beyond quota bypass (left to the security specialist).
