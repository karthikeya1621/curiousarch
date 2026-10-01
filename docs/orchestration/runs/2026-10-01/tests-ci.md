# Tests & CI specialist report - run 2 (Oct 1 2026)

Read-only review of commit 104e12d. Status after same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced verbatim from the specialist's final message.

**Gate results (verified by the specialist, offline, repo root at 104e12d):**
- `npm test`: exit 0. Engine 14 files/325 tests, web 27 files/352 tests = **677 passing**. The stack-trace-like lines are the same expected `console.error("[api] upstream failure: ...")` logs from error-path tests - all assert a 502/release, nothing new.
- `npm run typecheck`: exit 0, engine and web both clean.
- `npm run lint --workspace web`: exit 0, no warnings.

**Changed since run 1:**
- `.github/workflows/ci.yml` now has `npm run lint --workspace web` and `npm run build --workspace web` (placeholder `NEXT_PUBLIC_*` env) - confirmed present. Still **no** `permissions:`, `concurrency:`, `timeout-minutes:`, `npm audit`, or gitleaks anywhere in the file.
- `apps/web/tests/a11y-markup.test.tsx` - confirmed 7 tests exactly (3 Modal + 1 ConfirmDialog + 2 FailureIndicator + 1 GuestBanner). The GuestBanner case only covers the closed/resting live-region markup (`role="status"`, nothing rendered yet) - it does not touch the guest-limited, non-guest, or "Save my work" states run 1 asked for.
- `store.test.ts` new cases (zero-row update/delete, `projectsStatus === "error"`) checked against the real call sites in `lib/sessionStorage.ts` (`.update(...).eq().eq().select("id")`, `.delete().eq().eq().select("id")`) - the fake's `select()` correctly distinguishes "first call defines the op" from "chained after update/delete -> RETURNING", matching real PostgREST semantics. **Not a gap**: it's a faithful fake, not a new hole.
- `apps/web/db/guest-trial.sql` gained `trial_refund`, kind-scoped `trial_release(p_user, p_action, p_kind)`, and the `is_guest` upgrade flip - all still with **zero execution coverage** (no `db/tests/` directory exists; `trial-server.test.ts` still mocks `rpc()` completely).
- `app/login/page.tsx` + `LoginForm.tsx` (new Server/Client split, commits 884ad43->104e12d): confirmed **zero** test references anywhere in `apps/web/tests/` at the time of this review.

## Ranked findings (carried over, re-verified against current code)

1. **[HIGH]** `apps/web/db/guest-trial.sql` - SQL money/gating logic has never executed. No `db/tests/` dir, `trial-server.test.ts` mocks `rpc()` end to end. New branches since run 1 (`trial_refund` cap-of-1, kind-scoped `trial_release`, `is_guest` upgrade flip) are additional untested surface. Still needs a throwaway-Postgres job (plain `postgres:16` + stubbed `auth.users`/roles, per the YAML already drafted in `docs/orchestration/runs/2026-09-28/tests-ci.md`).
2. **[HIGH]** `apps/web/tests/trial-routes.test.ts` imports only `app/api/infer/route.ts`. `chat`, `rework`, `identify-failures`, `explain-fix` each call `reserveTrial(request, body, kind)` with no assertion the right kind is reserved, that a denial skips the engine, or that an engine failure releases. `it.each` over the 5 routes, reusing the existing mock.
3. **[MEDIUM]** Proxy public-path allowlist for `/privacy`, `/terms`, `/api/trial/status` is untested signed-out (`login-next.test.ts` covers `/`, `/project/...`, `/api/chat`, `/login` only); `/auth/callback` is tested for the GET handler itself but not for proxy pass-through. `site-seo.test.ts`'s matcher test only checks the regex string, not `proxy()` behavior - would still pass if the allowlist were deleted.
4. **[MEDIUM]** No test file for `/api/trial/me`, `/api/trial/status`, `/api/health`, or `robots.ts`/`sitemap.ts`/`manifest.ts` output.
5. **[MEDIUM]** CI still lacks `permissions:`, `concurrency:`, `timeout-minutes:`, `npm audit`, gitleaks, and a browser smoke test.
6. **[MEDIUM]** `app/login/page.tsx` + `LoginForm.tsx`: zero coverage of the Server Component split, `auto_select`/`text`/`width` options sent to Google Identity Services, and the ResizeObserver reveal gate. See the assessment below for the concrete smallest-set recommendation.
   *(Status: partially addressed same day - two new unit tests cover the server-side `guestTrialOpen()` caching behavior directly, mutation-checked. The login split's own render/reveal logic remains untested, per the specialist's assessment that this needs jsdom, which isn't set up in this repo - deferred.)*
7. **[LOW]** Same weak-test spots as run 1, unchanged.

## Login split: smallest set of tests that would catch a real regression

The repo has **no jsdom/happy-dom/@testing-library in `apps/web/package.json`** - vitest runs in the default `node` environment. Existing patterns (`rework-warning.test.tsx`, `admin-status.test.tsx`) get real coverage of hook-bearing client components via `renderToStaticMarkup` plus `vi.mock`, because initial render executes `useState`/`useSyncExternalStore`'s server snapshot but never commits effects. That pattern covers a meaningful slice of this gap for free:

- **No new dependencies needed:**
  - `LoginPage`: mock `guestTrialOpen`/`trialConfig`, call `await LoginPage()`, `renderToStaticMarkup` the result, assert the "or just look around" section is present/absent per `guestTrialOpen()`'s return.
  - `LoginForm` directly: mock `next/script` and `lib/supabase/client`; render with `initialGuest={{available:true/false,...}}` and assert the guest button/copy appears or doesn't, and the captcha container only appears when `captcha:true`.
  - A static-markup assertion that the Google button starts masked (skeleton visible, the wrapper carries `invisible absolute inset-x-0`) before any height is known.

- **Genuinely needs jsdom** (not necessarily a real browser), because it requires committing effects and firing synthetic events - `ResizeObserver` callback, the Google script's `onLoad`, and `window.location.assign` calls:
  - ResizeObserver reveal: stub `global.ResizeObserver`, mount with `@testing-library/react`, fire a fake entry, assert the skeleton disappears and the wrapper's height style updates.
  - Google `onLoad`: stub `window.google.accounts.id`, trigger the script's `onLoad`, assert `initialize`/`renderButton` were called with the right options.
  - `window.location.assign` on sign-in/sign-out.
  - This set needs adding `jsdom` + `@testing-library/react` as devDependencies and a `// @vitest-environment jsdom` pragma - a real cost, but not a browser.

- **Genuinely needs a real browser, not just jsdom**: the actual Google Identity Services script execution - its real measured button height and the personalized->generic content swap that commit 104e12d is trying to suppress can only be verified against Google's real client-side JS and a real signed-in-to-Google session. This is exactly what the already-referenced Playwright `run-web` driver is for, and it still isn't wired into CI.

## Checked and sound
- `.github/workflows/ci.yml` lint + placeholder-env build steps are present and correctly scoped.
- The fake Postgrest client in `store.test.ts` is realistic and matches the real `.update()/.delete().select("id")` RETURNING pattern used in `lib/sessionStorage.ts` - not a hidden regression.
- `reserveTrial`'s gating logic and `trial_release`-by-kind are unit-tested at the mock-rpc level - the gap is specifically the route-level wiring (finding 2) and the SQL execution (finding 1), not the TS logic itself.
- Engine's 325 tests and web's other 351 tests untouched/green; no regressions introduced since run 1's 650 -> now 677.

## Not checked
- `next build` (not run per instructions, though the orchestrator ran it separately and confirmed green after the Next.js version bump), `npm audit`, live browser/Playwright run, real-database SQL behavior.
