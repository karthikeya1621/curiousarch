# Security specialist report - run 2 (Oct 1 2026)

Read-only review of commit 104e12d (live in production). Status after same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced verbatim from the specialist's final message.

[HIGH] apps/web/package.json:"next":"16.3.5" (apps/web/node_modules/next) - Critical RCE advisory in the installed Next.js version.
Scenario: `npm audit --omit=dev` reports GHSA-vcvr-r3jv-pc5j, CVSS 9.5, "Next.js: Remote Code Execution in next/og ImageResponse," affecting 16.2.0-16.3.5, fixed in 16.3.6 (audit suggests 16.3.8, a non-major bump). The advisory's own exploit condition is narrower than its title: it fires only through the Node.js `ImageResponse` renderer when attacker-controlled values reach SVG content/attributes/styles. `grep` for `next/og` and `ImageResponse` across `app/`, `components/`, `lib/` found no uses, and every icon/OG file under `apps/web/app` (`apple-icon.png`, `favicon.ico`, `icon.svg`, `opengraph-image.png`, `twitter-image.png`) is a static asset, not a dynamic `.tsx` route - so this app does not appear to call the vulnerable code path today. The risk is a critical CVE sitting in a live production dependency tree, one trivial patch release away from fixed, and a single future route using `ImageResponse` (or an unnoticed internal Next.js code path) would land directly in the vulnerable window.
Fix: Bump `next` to >=16.3.6 (package.json + lockfile), rerun `npm audit`, confirm `next build` and the test suite stay green.
Confidence: confirmed by reading `npm audit` output and the advisory; non-reachability from the app's own code confirmed by grep, not from reading Next's internals.
*(Status: fixed same day - bumped to 16.3.8, `npm audit --omit=dev` now reports 0 vulnerabilities, typecheck/lint/tests/build all verified green.)*

[LOW] apps/web/proxy.ts:44-45,71-73 - Unanchored prefix/suffix matches on the public-path and matcher exclusions, unchanged since run 1.
Scenario: `pathname.startsWith("/login")`/`"/auth"` would also match a future `/loginX` route; the matcher's `api/health`, static-file and image-extension exclusions are prefix/suffix matches, not anchored with `(/|$)`. No such route exists today, so there is still no live bypass, but every new route added to this live app is one more chance to collide with this unanchored string match.
Fix: unchanged from run 1 - `pathname === "/login" || pathname.startsWith("/login/")` (same for `/auth`); anchor the matcher exclusions.
Confidence: confirmed by reading code (still present, verbatim).

[LOW] apps/web/lib/trial/server.ts:28-40 - The quota gate still fails open (`noop`) if `supabase.auth.getUser()` throws, unchanged since run 1.
Scenario: A transient Supabase Auth error during `getUser()` makes `reserveTrial` return `noop`, so that one AI call runs unmetered (middleware has already authenticated the request, so this isn't an open door, just an uncounted call). With real production traffic now flowing at volume instead of test traffic, the absolute number of times this edge case fires is no longer zero, though it is still not a targeted, repeatable bypass.
Fix: unchanged from run 1 - return `denied` on `!user` or exception instead of `noop`; needs the route-test mocks run 1 deferred this for.
Confidence: confirmed by reading code; frequency under live load is plausible only (no logs reviewed).

[LOW] apps/web/app/api/usage/outcome/route.ts:35 and db/guest-trial.sql (`ai_action_outcomes` table) - Still no unique constraint; unmetered inserts, unchanged since run 1.
Scenario: Any signed-in or guest user can POST `{actionId, reason}` with a fresh UUID in a loop, inserting unlimited rows (204 every time, no dedupe). Pure storage growth, not a spend or quota bypass (confirmed `refundWithheldRework` is still capped server-side at 1 per account via `trial_refund`).
Fix: unchanged from run 1 - `unique (user_id, action_id, reason)` with `on conflict do nothing`.
Confidence: confirmed by reading code.

[LOW] apps/web/lib/trial/policy.ts:71-78 - IPv6 clients still hashed on the full address, unchanged since run 1.
Scenario: `clientIp` takes the raw first `x-forwarded-for` hop as-is and `hashIp` hashes that whole string; an attacker with a /64 IPv6 allocation gets effectively unlimited distinct hashes and bypasses `trial_reserve`'s per-IP account cap (`p_ip_cap`).
Fix: unchanged from run 1 - truncate to the /64 prefix before hashing.
Confidence: confirmed by reading code.

[LOW] apps/web/components/AccountMenu.tsx (new `signOut` catch block, added in the error-handling sweep) - Raw Supabase client error text is now shown to the user on sign-out failure, same pattern as the pre-existing login-form error display.
Scenario: `setSignOutError(err instanceof Error ? err.message : ...)` surfaces whatever message the Supabase JS client attaches to a failed `signOut()` call directly in a `role="alert"` on the page. This mirrors the already-present pattern in `LoginForm.tsx` (`setError(error.message)` on every auth call), so it isn't a new category of exposure, just one more site using it. Supabase client-side auth errors are generally generic ("network error", "session not found") rather than sensitive, so impact is low.
Fix: if this pattern is ever revisited, map known Supabase error codes to fixed copy instead of echoing `error.message` directly; not urgent.
Confidence: confirmed by reading code; sensitivity of possible message contents is plausible only.

**Checked and sound**
- `app/login/page.tsx` + `LoginForm.tsx` split: `guestTrialOpen()` returns only a boolean (no spend figures, no internals), `page.tsx` is `force-dynamic` (never cached/frozen stale), and the client re-check in `LoginForm.tsx` only replaces state on an actual change. No new data reaches the client beyond what `/api/trial/status` already exposed. The Google-button height/auto_select/text changes are cosmetic only - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` exposure is unchanged and expected.
- `app/auth/callback/route.ts`: unchanged since run 1; still redirects on a failed code exchange with `?error=link` rather than failing silently, and `next` still only ever comes from `safeNextPath`.
- The error-handling/loading-state sweep (`FlowDiagram`, `ProjectsCard`, `sessionStorage.ts`, `projectSlice.ts`): every new catch block either shows a fixed, generic message or routes the raw error to `console.error` only (client-side, the user's own browser console - not a server log, not cross-user). None of it touches auth, quota or RLS boundaries; `git diff` confirms zero changes to `app/api/**`, `lib/trial/**`, `lib/usage/**` or `lib/apiRoute.ts` since the run 1 fixes landed.
- AI-route trust boundary unchanged and still sound: `readJsonBody`/`isRequestTooLarge` measure the real body length (not just `content-length`), `upstreamError` still gates `detail` on non-production, and the `trial_reserve`/`trial_release`/`trial_refund` SQL (re-read in full) still matches the run 1 fix exactly - release-by-kind, refund capped at 1 via `trial_accounts.refunds`, member daily budget applied to non-guests, advisory-lock serialization.
- `projects.sql`: the C1 abuse-limit fix (4 MB `pg_column_size` check, 3/200 row-cap trigger keyed on `auth.jwt() ->> 'is_anonymous'`) is present in both `projects.sql` and `setup-production.sql`, matching the run 1 plan.
- `next.config.ts`, admin allow-list (`lib/admin.ts`, `app/api/admin/status`), `nextPath.ts` (`safeNextPath`): all unchanged, still sound as described in run 1.
- `npm audit`: only one advisory in the whole dependency tree (the Next.js one above); nothing else outstanding.

**Not checked**
- Live Supabase project settings (captcha enforcement on anonymous sign-in / OTP, email rate limits, anonymous-sign-in toggle) and Vercel env values - not readable from the repo, same as run 1.
- Whether `db/projects.sql`'s abuse-limit migration has actually been applied against the production database (run 1 ACTION-ITEMS flagged it as written but not yet run against any DB) - this is a live-infra check, not a code read, and out of scope for this read-only pass.
- `packages/engine` prompt-construction internals beyond the route boundary; no changes found there since run 1 besides the already-fixed debug-log gating.

**Changed since run 1:** The login-page split, the error-handling/loading-state sweep, and the Google-button tweaks introduce no new auth, quota, RLS or XSS exposure - `git diff` against the post-run-1 commit confirms zero touches to `app/api/**`, `lib/trial/**`, `lib/usage/**`, SQL, or `next.config.ts`. The one genuinely new finding this run is the dependency scan run 1 explicitly skipped: `next@16.3.5` carries a critical (unreached, by current grep) RCE advisory, fixed by a one-version, non-major bump. Everything else security-relevant from run 1's deferred C2/C3 list (fail-open gate, IPv6 hashing, unanchored proxy prefixes, missing unique constraint) is unchanged in the code - none of it has grown a new, more-direct exploit path now that the site is live, though the fail-open gate's real-world hit rate is no longer provably zero the way it was pre-launch.
