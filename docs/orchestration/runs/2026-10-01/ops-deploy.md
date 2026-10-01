# Operations & deploy-readiness specialist report - run 2 (Oct 1 2026)

Read-only review of commit 104e12d, live in production. Status after same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced verbatim from the specialist's final message.

**[HIGH] apps/web/app/login/page.tsx:8,18 - `/login` went from a static page to a per-request function with a direct, uncached Supabase RPC call**
Scenario: before `b7f4946`, `/login` was a plain `"use client"` page (no Server Component, no `dynamic` export) - prerendered once at build and served as static HTML/CDN edge content; the only Supabase hit was a client-side `fetch("/api/trial/status")` after mount, which is CDN-cacheable (`s-maxage=30`). Since `b7f4946`, `page.tsx:8` sets `export const dynamic = "force-dynamic"` and `page.tsx:18` calls `guestTrialOpen()` directly in the Server Component, which runs `admin.rpc("trial_budget_open", ...)` - a live, uncached Supabase call, on every single request. `/login` is the one page marked indexable, so this also fires on every search-crawler hit, not just real visitors. The in-code comment claimed "replaces the client-side fetch... same total load as before," but it does not replace it: `LoginForm.tsx` still runs the same client-side `fetch("/api/trial/status")` in a `useEffect` afterward. Net effect: every `/login` view now costs one Vercel function invocation (previously zero) plus one uncached DB round trip, *in addition to* the pre-existing cached client fetch - not instead of it.
Fix: either (a) have `page.tsx` call the already-cached `/api/trial/status` route internally instead of calling `guestTrialOpen()` raw, or (b) accept the function-per-view cost and document it. At minimum, fix the misleading "same total load" comment.
Confidence: confirmed by reading `page.tsx`, `LoginForm.tsx`, `trial/server.ts`, and the pre-split version of the page.
*(Status: fixed same day - `guestTrialOpen()` gained its own 30s in-process cache (option closer to (a), without the self-HTTP-fetch overhead); the misleading comment was corrected. The per-request function invocation itself is an accepted, documented tradeoff for no longer popping in the guest option after mount.)*

**[LOW] docs/DEPLOYMENT.md - not updated for the login Server Component or the error/loading sweep**
Scenario: nothing documents the login page's new dynamic-rendering cost. Not a functional bug, but the operational implication was entirely undocumented.
Fix: one line in `docs/DEPLOYMENT.md` noting `/login` is dynamically rendered per-request since it is also the indexable page.
Confidence: confirmed (grep for related terms in both files returns nothing).
*(Status: deferred - documentation-only, low priority.)*

**[LOW] next.config.ts - `dynamic = "force-dynamic"` would silently stop working if Cache Components is ever turned on**
Scenario: this Next version's own docs say `dynamic`/`revalidate`/`fetchCache` route-segment exports are *removed* once `cacheComponents` is enabled in `next.config.ts`. Today `cacheComponents` is not set, so `force-dynamic` behaves as documented and this is not a live bug - purely forward-looking, for a future Next upgrade.
Confidence: confirmed from this Next version's own docs; no current impact.
*(Status: deferred - forward-looking only, noted for the next Next.js upgrade.)*

**[INFO, not a finding] Retention/purge and admin dashboard hold up fine under real data**
Checked specifically because a real guest now exists in production: `purge_anonymous_users` deletes from `auth.users` by `created_at`, and `ai_calls.user_id` deliberately has **no foreign key** to `auth.users` - so purging a guest cannot fail on an FK violation even though that guest generated real `ai_calls` rows. `projects.user_id` does cascade. The admin dashboard's per-user email lookups are bounded by the SQL's own `limit 10`/`limit 20` clauses, so real traffic doesn't turn it into an unbounded fan-out. No change needed here.
Confidence: confirmed by reading the schema and dashboard code. Whether the two `cron.schedule` jobs are actually registered in the **production** Supabase project (run 1 verified them on dev) cannot be checked from the repo - owner-only check.

**[CONFIRMED, from the live guest trial] Evidence that TRIAL_ENABLED, TRIAL_IP_SALT, and SUPABASE_SERVICE_ROLE_KEY are set correctly in production**
A guest reaching the one-build quota is only possible if `reserveTrial` ran against a real admin client with a real salt. This confirms three of run 1's "owner action, status unknown" items are in fact done. Does not confirm SMTP (guests don't use email) or the Anthropic console spend cap - those remain unknown.

**Checked and sound**
- `maxDuration = 300` still present on all five AI routes.
- `error.tsx`, `global-error.tsx`, `not-found.tsx` still present and substantive, untouched by the recent sweep.
- `.mcp.json` correctly gitignored and not tracked - not re-flagged, it's intentional per the owner.
- `/api/health` is still deliberately shallow (by design), matches the still-open deferred item, not a regression.
- CI still runs typecheck, lint, test, and `next build` with placeholder `NEXT_PUBLIC_*` values.
- `engines.node: "24.x"`, `.nvmrc` = 24, consistent.
- `npm run typecheck` is clean across both workspaces.
- `/admin/usage` is still gated by `requireAdmin()` before any data fetch, still `noindex`.
- The error-handling/loading-state sweep and Google Identity changes are client-side UI-only changes; no new server-side logging, no new env vars.

**Not checked**
- Live Vercel plan/Fluid duration limits, actual function invocation counts/cost, and whether `select jobname from cron.job;` returns both rows in the **production** Supabase project (owner-only).
- Whether custom SMTP is actually configured in prod.
- Browser/visual check of the login page's dynamic rendering in practice.

**Go/no-go for continued operation: GO**, with one fix recommended soon, not urgently (now fixed same day). Nothing found here was a regression that threatened correctness, security, or data integrity - the app had already taken a real guest through signup and a quota-limited build successfully, the strongest evidence this review could get that the trial path, Supabase RPCs, and quota enforcement work in production. The still-open items from run 1 (SMTP confirmation, Anthropic spend cap, error monitoring, deeper health probe, build-time env guard, account deletion, legal review) are unchanged in status - none are new regressions from this round's code changes, and the owner has already explicitly deferred several of them.

**Changed since run 1:** The login redesign, the error-handling sweep, and the Google button fix were all reviewed for operational impact. The one real finding (the login page's caching regression) is the same one performance and correctness independently flagged, and all three were resolved with the same fix (an in-process cache in `guestTrialOpen()`). Separately, a dependency scan (not run in run 1) found a critical Next.js CVE in the production bundle - see security.md; fixed same day by bumping to 16.3.8, verified with a clean `npm audit --omit=dev`, typecheck, lint, the full test suite, and a successful production build.
