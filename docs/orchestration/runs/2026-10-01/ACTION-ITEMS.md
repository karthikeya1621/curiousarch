# Run 2 — merged action items (Oct 1 2026)

Baseline: commit `104e12d` (live in production). Six specialists (security, correctness, performance-cost, accessibility-ux, tests-ci, ops-deploy) reviewed read-only in parallel; every finding below was then independently re-verified against the code before any fix, per the orchestration pattern in [../../README.md](../../README.md).

## Fixed this run

| # | Finding | Found by | Fix |
|---|---|---|---|
| 1 | `next@16.3.5` — critical RCE advisory (GHSA-vcvr-r3jv-pc5j) in a live production dependency, not currently reached by app code but one patch release from safe | security | Bumped to `16.3.8`; `npm audit --omit=dev` now reports 0 vulnerabilities |
| 2 | `guestTrialOpen()` called raw from `app/login/page.tsx` (Server Component, `force-dynamic`) bypassed the CDN-cached `/api/trial/status` route entirely — every `/login` view hit Supabase's `trial_budget_open` RPC uncached, additive to (not a replacement of) the existing client-side fetch | performance-cost, ops-deploy (independently) | Added a 30s in-process TTL cache inside `guestTrialOpen()`; corrected the misleading "replaces the client fetch" comment; added `__resetGuestOpenCacheForTests()` and a regression test |
| 3 | `role="alert"` placed directly on the retry `<button>` in `AutoSaveIndicator.tsx`, stripping its native button semantics for assistive tech | accessibility-ux | Moved `role="alert"` to a wrapping `<span>`; button keeps native semantics; added a structural source-text regression test (no jsdom in this repo) |
| 4 | Google-button `ResizeObserver` never disconnects after first reveal — if Google's own personalized→generic button swap isn't suppressed by `auto_select`/`text`, the wrapper's un-transitioned height would snap | correctness | Added `motion-safe:transition-[height] motion-safe:duration-200` on the wrapper; observer intentionally still never disconnects (tracks genuine later size changes) |
| 5 | `ProjectsCard`'s single shared `deletingId`/`deleteError` cross-talk between concurrent deletes of different projects | correctness | Refactored to `deletingIds: Set<string>` / `deleteErrors: Map<string,string>`, keyed per project; a project's own stale error also now clears the moment its trash icon is clicked again |
| 6 | `lib/sessionStorage.ts`'s four exported functions called `currentUserId()` outside their own `try` block, contradicting the documented "never throws" contract and leaving `refreshProjectList` stuck on `"loading"` forever if `getSession()` itself threw | correctness | Moved `createClient()`/`currentUserId()` inside each function's `try`; added a test confirming `refreshProjectList` now reaches `projectsStatus: "error"` |
| 7 | Google sign-in slot gave screen-reader users no "loading" signal before the script renders | accessibility-ux | Added a `sr-only role="status"` loading announcement alongside the skeleton |

All seven fixes were mutation-checked (reverted, confirmed the new/updated test fails, restored) where a test was added.

## Verified sound, no fix needed

- CDN caching on `/api/trial/status` (`s-maxage=30`) — already in place from run 1, unchanged and correct.
- `ResizeObserver` cleanup in `LoginForm.tsx` and `FlowDiagram.tsx` — both correctly `disconnect()` on unmount.
- `sessionStorage.ts`'s zero-row `.select("id")` checks on update/delete — already fixed in run 1, re-verified sound, and is the *only* mutation surface in the app (grepped).
- `app/login/page.tsx`/`LoginForm.tsx` hydration: server/client initial state match exactly, no mismatch.
- `.mcp.json` gitignored with a real local Supabase token — intentional per owner instruction, not re-flagged.
- `ai_calls.user_id` has no FK to `auth.users` by design, so `purge_anonymous_users` cannot fail on an already-used guest — confirmed under real production data (a real guest has now used the trial).
- `TRIAL_ENABLED`, `TRIAL_IP_SALT`, `SUPABASE_SERVICE_ROLE_KEY` confirmed correctly set in production (inferred from a real guest successfully hitting their one-build quota).
- Compacted `LoginHero.tsx` — contrast ratios unaffected by the size reduction, still well above AA.
- Diagram-node keyboard access, `Modal`/`ChatWidget` focus trapping, live regions, `globals.css` border-layer fix, project row/size limits (all from the Sep 28 pass) — re-verified genuinely in code, not just claimed.
- Full gate: `npm run typecheck` clean (engine + web), `npm run lint --workspace web` clean, **680 tests passing (325 engine + 355 web)**, production build succeeds with `/login` correctly marked `ƒ` (dynamic).

## Deferred (unchanged from run 1, or newly identified but explicitly not urgent — no action without being asked)

| Severity | Item | Why deferred |
|---|---|---|
| LOW | Google `<Script>` has no `onError`/timeout fallback if GSI is blocked | Pre-existing (confirmed present before this round's changes too), low severity, needs product decision on fallback copy |
| LOW | Unanchored proxy path prefix/suffix matches (`/login`, `/auth`, matcher exclusions) | Unchanged since run 1, no live route collision exists today |
| LOW | Quota gate fails open (`noop`) on `getUser()` exception | Unchanged since run 1, needs route-test mocks not yet built |
| LOW | No unique constraint on `ai_action_outcomes` | Unchanged since run 1, storage growth only, not a spend bypass |
| LOW | IPv6 hashed on full address, not /64 prefix | Unchanged since run 1 |
| LOW | Raw Supabase error text shown on sign-out failure | Same existing pattern as login form errors, low sensitivity |
| LOW | `docs/DEPLOYMENT.md` not updated for `/login`'s per-request function cost | Documentation only |
| LOW | `cacheComponents` would silently void `force-dynamic` in a future Next upgrade | Forward-looking only, not a current issue |
| MEDIUM | 3 sequential `getUser()` calls per AI request (proxy + reserveTrial + startUsage) | Unchanged since run 1, needs `getClaims()` migration or shared-user plumbing |
| MEDIUM | Two separate admin-status fetches/checks instead of one | Unchanged since run 1 |
| MEDIUM | No index fitting `trial_spend_today`'s date-range scan | Unchanged since run 1 |
| MEDIUM | No per-action model-call cap in `structuredCall`/`fromProse`/`reworkModel` | Unchanged since run 1 |
| MEDIUM | `computeCost` fails open ($0) on an unpriced model, never trips the budget cap | Unchanged since run 1 |
| LOW | No composite `projects(user_id, updated_at desc)` index | Unchanged since run 1 |
| LOW | `versions`/chat messages storage uncapped | Unchanged since run 1 |
| LOW | ELK layout engine not warmed ahead of first use | Unchanged since run 1 |
| HIGH (tests) | `db/guest-trial.sql` has zero execution coverage (SQL money/gating logic only ever mocked) | Needs a throwaway-Postgres CI job; drafted but not built |
| HIGH (tests) | Only `/api/infer` is tested for trial-reservation wiring; `chat`/`rework`/`identify-failures`/`explain-fix` are not | Needs an `it.each` expansion of the existing route test |
| MEDIUM (tests) | Proxy public-path allowlist (`/privacy`, `/terms`, `/api/trial/status`) untested signed-out | Needs a `login-next.test.ts` expansion |
| MEDIUM (tests) | No tests for `/api/trial/me`, `/api/trial/status`, `/api/health`, `robots.ts`/`sitemap.ts`/`manifest.ts` | Not yet written |
| MEDIUM (tests) | CI lacks `permissions:`, `concurrency:`, `timeout-minutes:`, `npm audit`, gitleaks | Not yet built |
| MEDIUM (tests) | Login-split render/reveal logic (`ResizeObserver` callback, Google `onLoad`, `window.location.assign`) untested | Needs jsdom + `@testing-library/react`, not currently installed in this repo — a real added dependency, not done without being asked |
| — | Whether `auto_select:false`/`text:"signin_with"` actually suppress Google's personalized→generic button swap | Unverifiable without a real signed-in-to-Google browser against the live site |
| — | devDependency vulnerabilities (vitest/esbuild/vite via `npm audit`) | Needs a vitest v5 major-version bump — explicitly a breaking change, not done without being asked |

## Gate status at end of run

- `npm run typecheck` — clean (engine + web)
- `npm run lint --workspace web` — clean
- `npm test` — **680 passing** (325 engine + 355 web), up from 674 pre-fix (3 new regression tests added this run, one pre-existing test count correction)
- `npm run build --workspace web` — succeeds; `/login` confirmed `ƒ` (dynamic server-rendered)
- `npm audit --omit=dev` — 0 vulnerabilities (previously 1 critical)

Nothing in this run has been committed or pushed — awaiting explicit instruction, per standing project rule.
