# Production-readiness orchestration

A repeatable way to review and harden this repo before a release using one **orchestrator** (the main Claude session) and six **specialist agents**. The point is breadth without collisions: specialists look at the code from different angles in parallel and only *report*; one agent (the orchestrator) decides what is real and makes every change.

> Status: written Sep 28 2026, run twice since (Sep 28, Oct 1). Run it with the `/prod-readiness` skill (`.claude/skills/prod-readiness/SKILL.md`) or by hand as below, then record the outcome under "Runs" at the bottom.

## Roles

| Role | Brief | Looks for |
|---|---|---|
| Security | [agents/security.md](agents/security.md) | auth gate, RLS, quota bypass, open redirects, XSS, prompt-injection blast radius, cost abuse |
| Correctness & reliability | [agents/correctness.md](agents/correctness.md) | race conditions, release/reserve ordering, error paths, timeouts, stale state, SQL logic |
| Performance & cost | [agents/performance-cost.md](agents/performance-cost.md) | bundle weight, redundant calls, Supabase round trips, AI call fan-out and spend |
| Accessibility & UX | [agents/accessibility-ux.md](agents/accessibility-ux.md) | WCAG 2.2 AA, focus, contrast in both themes, mobile, copy |
| Tests & CI | [agents/tests-ci.md](agents/tests-ci.md) | untested money/security behaviour, weak tests, missing CI steps |
| Operations & deploy | [agents/ops-deploy.md](agents/ops-deploy.md) | env handling, function limits, error boundaries, monitoring, retention jobs, docs accuracy |
| **Orchestrator** | this file | scoping, triage, fixes, verification, the final report |

## Phases

1. **Scope.** Fix the target (a commit or the working tree) and the launch context (free product? billing? who is the audience?). Run `git status` and the test suite first so the specialists start from a known baseline. Put the context in every brief.
2. **Fan out (parallel, read-only).** Launch all six specialists in ONE message so they run concurrently. Each gets its brief plus the shared rules below. They return a ranked findings list in the format in [REPORT-TEMPLATE.md](REPORT-TEMPLATE.md).
3. **Triage (orchestrator only).** Merge, de-duplicate, and **re-verify every finding against the code yourself** before believing it: specialists are cold-started and can be wrong or overstate severity. Classify each as `fix now`, `fix later`, `won't fix (reason)` or `false positive`. Anything touching money, auth or data loss defaults to `fix now`.
4. **Fix (orchestrator, or specialists one at a time).** Changes are made serially, smallest first, by one agent, never by parallel writers on the same tree. If work must run in parallel, give each agent its own git worktree (`isolation: "worktree"`) and disjoint files, and merge yourself.
5. **Verify.** `npm run typecheck`, `npm run lint --workspace web`, `npm test`, and `next build` in `apps/web`. For UI changes, a browser check (the `run-web` skill). New tests are mutation-checked: break the code, confirm the test fails.
6. **Report.** Write the findings ledger and the go/no-go into "Runs" below, update the test counts in `CONTEXT.md`/`README.md`/`plans/PLAN-4.md`, and add durable decisions to the matching `docs/context/*.md` file. Commit only when the owner says so.

## Rules every specialist gets

- **Read-only.** No edits, no file creation or deletion. Findings only.
- **No paid calls.** No live Anthropic requests. Free, offline commands (typecheck, unit tests) are fine.
- **No secrets.** Never print `.env*` contents or keys; list variable *names* only.
- **Verified claims only.** Every finding cites `file:line`, a concrete failure scenario and a minimal fix, and says whether it was confirmed by reading code or is only plausible. Also list the areas checked and found sound.
- **Next.js here is not the one you know.** `apps/web/AGENTS.md`: read `node_modules/next/dist/docs/` before judging Next-specific behaviour (for example `middleware.ts` is `proxy.ts`).
- Use they/them for people; keep output concise, no preamble.

## Orchestrator rules

- Launch independent specialists in one message; never wait on one to start another.
- A specialist's report is a lead, not a fact. Read the cited lines before acting.
- Do not let two writers touch the same files. Do not commit or push without the owner's say-so.
- Judgment about a system's design belongs to the AI at runtime; code enforces structural validity only (see the project memory and `docs/context/`). Do not add keyword or threshold heuristics to satisfy a finding.
- Stop when the remaining findings are `fix later` or below and the verification gate is green; write down what was deferred and why.

## Severity scale

`blocker` (do not launch) > `high` (fix before launch) > `medium` (fix soon) > `low` (backlog). Security and data-loss findings are never below `medium`.

## Runs

### Run 1 - Sep 28 2026 (reviewed on top of 3015f46; fixes committed as 884ad43)

Full specialist reports and the action list: [runs/2026-09-28/](runs/2026-09-28/) ([ACTION-ITEMS.md](runs/2026-09-28/ACTION-ITEMS.md)).

Six specialists ran in parallel, read-only. Gate at start: typecheck, lint and 650 tests green (run by the tests-ci specialist); nothing browser-tested. Several findings were reported by 3+ specialists; those are merged. Each was re-read against the code before triage (verified: SDK default retries, client-callable quota refund, content-length-only size guard, silent auth-callback failure).

| # | Sources | Sev | Finding | Decision |
|---|---|---|---|---|
| 1 | sec, corr, tests | high | `usage/outcome` lets a guest refund their own quota with any action id (unlimited calls) | fix now |
| 2 | corr, tests | high | `trial_release` frees every kind under an action id: a failed findings call refunds the build | fix now (release by kind) |
| 3 | sec, perf, ops | high | signed-in accounts have no aggregate spend cap; `TRIAL_ENABLED=false` means unlimited | fix now (budget for members; docs) |
| 4 | corr, perf, ops | high | no `maxDuration` on AI routes; SDK default retries stack under ours | fix now |
| 5 | corr | high | findings failure leaves no retry; limited users cannot start a new project | fix now |
| 6 | corr, ops, a11y | high | no `error.tsx` / `global-error.tsx` / `not-found.tsx` | fix now (`retry()` API in this Next) |
| 7 | ops | high | untracked source (LoginHero, EmptyStateAside, setup-production.sql) - Vercel builds from git | commit when owner says |
| 8 | ops | high | custom SMTP not documented (magic link and guest upgrade would fail for non-team emails) | docs now, owner action |
| 9 | ops | high | purge jobs never scheduled by the SQL; privacy page promises 30-day deletion | fix now (cron in SQL) |
| 10 | sec, perf | med | size guard trusts `content-length`; no caps on strings, `history`, `pendingFixes` | fix now |
| 11 | sec, ops | med | IP-hash salt falls back to a public constant | fix now |
| 12 | corr, ops | med | auth callback ignores a failed code exchange (silent) | fix now |
| 13 | corr | med | slow Build can overwrite a project opened meanwhile | fix now (epoch guard) |
| 14 | corr | med | `is_guest` never flips after upgrade | fix now (SQL) |
| 15 | corr, sec, ops | low | quota gate fails open if `getUser` throws (proxy already authenticated) | fix later: needs route-test mocks |
| 16 | ops | med | HSTS includeSubDomains + 2 years; Vercel ignores `.nvmrc`; CI has no lint/build | fix now (config, docs, CI) |
| 17 | a11y | blocker | node details unreachable by keyboard; modals have no focus management | fix in a11y pass |
| 18 | a11y | major | slate-400 text ~2.5:1 in light theme (~55 uses); Re-simulate and failure badges low contrast; unlabeled email inputs; no live regions; header overflow and Google button width at 360px; global border rule beats Tailwind utilities | fix in a11y pass |
| 19 | perf | med | up to 3 auth round trips per AI call, ~7 on page load; `/api/trial/status` runs an aggregate every visit | fix later (cache status now) |
| 20 | perf | med | no per-action model-call cap (worst case 20 calls) | fix later |
| 21 | ops, sec | low | logo-v5.svg + Next boilerplate in `public/`; `.mcp.json` tracked; no LICENSE; stale README counts | cleanup with owner |
| - | tests | high | trial SQL never executed by any test; only /api/infer gating tested; new UI untested | add SQL test job + route tests (later, needs a database) |

**Outcome (same day):** fixed #1-6, #9-14, #16 (HSTS, `engines`, CI lint+build) and the cheap parts of #8, #18 (email input label, `role=alert` on login errors); docs updated for #3, #8, #9. Gate after fixes: typecheck clean, eslint clean, 658 tests (317 + 341, 8 new), production build OK. Mutation-checked: release-by-kind, request-size guard. NOT done: #7 (commit), the a11y pass (#17, rest of #18), #15, #19-21, SQL execution tests. The new SQL (`trial_refund`, kind-scoped `trial_release`, member budget, `is_guest` flip, cron) has never run against a database - re-run `setup-production.sql` in dev and prod before deploying this code (the app now calls the 10-argument `trial_reserve` and 3-argument `trial_release`).

Deferred and why: #15 (needs mocks in five route tests; window is tiny behind the proxy), #19 beyond caching the public status, #20, SQL execution tests (need Postgres in CI), the a11y pass (~30 small edits, done as its own reviewed batch).

### Run 2 - Oct 1 2026 (reviewed on top of 104e12d, live in production)

Full specialist reports and the action list: [runs/2026-10-01/](runs/2026-10-01/) ([ACTION-ITEMS.md](runs/2026-10-01/ACTION-ITEMS.md)).

Six specialists ran in parallel, read-only, against the live production commit — the first run reviewed after a real guest had already completed a quota-limited build end to end. Gate at start: typecheck, lint and 674 tests green. Each finding was re-verified against the code before triage.

| # | Sources | Sev | Finding | Decision |
|---|---|---|---|---|
| 1 | security | high | `next@16.3.5` carries a critical RCE advisory (GHSA-vcvr-r3jv-pc5j), not currently reached by app code but one patch release from safe | fix now (bumped to 16.3.8) |
| 2 | performance-cost, ops-deploy | medium | `guestTrialOpen()` called raw from the new `app/login/page.tsx` Server Component bypassed the CDN-cached `/api/trial/status` route — additive, not a replacement, to the existing client fetch | fix now (30s in-process cache) |
| 3 | accessibility-ux | major | `role="alert"` on the `AutoSaveIndicator` retry `<button>` stripped its native button semantics | fix now |
| 4 | correctness | medium | Google-button `ResizeObserver` never disconnects, so an unsuppressed personalized→generic swap could still snap the layout | fix now (CSS height transition) |
| 5 | correctness | medium | `ProjectsCard`'s shared `deletingId`/`deleteError` cross-talk between concurrent deletes of different projects | fix now (Set/Map keyed by id) |
| 6 | correctness | low | `sessionStorage.ts`'s four functions called `currentUserId()` outside their own try block, contradicting the documented "never throws" contract | fix now |
| 7 | accessibility-ux | minor | no loading announcement for screen-reader users before the Google button renders | fix now (sr-only status); timeout/fallback for a script that never loads deferred |
| - | tests-ci | high | `db/guest-trial.sql` still has zero execution coverage; only `/api/infer` tested for trial-reservation wiring | unchanged from run 1, deferred (needs Postgres in CI) |
| - | performance-cost | medium | 3 sequential `getUser()` calls per AI request; no admin-status fetch dedup; no index fitting `trial_spend_today`; no per-action model-call cap; `computeCost` fails open on an unpriced model | unchanged from run 1, deferred |
| - | security | low | unanchored proxy path matches; fail-open quota gate on `getUser()` exception; no unique constraint on `ai_action_outcomes`; IPv6 hashed on full address | unchanged from run 1, deferred |

**Outcome (same day):** fixed #1-7. Gate after fixes: typecheck clean (engine + web), lint clean, **680 tests** (325 + 355, 3 new), `npm audit --omit=dev` → 0 vulnerabilities (was 1 critical), production build OK with `/login` confirmed `ƒ` (dynamic). Mutation-checked: `guestTrialOpen` caching, the `AutoSaveIndicator` role-placement regression guard, `refreshProjectList` reaching `"error"` on a thrown `getSession()`. NOT done: the full tests-ci backlog (SQL execution job, route-gating `it.each` expansion, proxy public-path tests, CI hardening, login-split jsdom tests), the run-1 deferred medium/low performance and security items (unchanged, still open), `docs/DEPLOYMENT.md` update for `/login`'s per-request cost, and the devDependency `npm audit` items (vitest v5 is a breaking change).

Deferred and why: all tests-ci items need either a throwaway-Postgres CI job or `jsdom`/`@testing-library/react` as new devDependencies — real additions, not done without being asked. The run-1 performance/security backlog is unchanged in severity and was re-confirmed, not re-litigated, since nothing about going live made any of it more urgent than before. Whether `auto_select`/`text` actually suppress Google's personalized-button swap remains unverified — needs a real signed-in-to-Google browser against the live site.

