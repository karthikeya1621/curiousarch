# Action items - run 1 (Sep 28 2026)

Merged from the six specialist reports in this folder ([security](security.md), [correctness](correctness.md), [performance-cost](performance-cost.md), [accessibility-ux](accessibility-ux.md), [tests-ci](tests-ci.md), [ops-deploy](ops-deploy.md)). Every item was checked against the code before it was accepted. Status as of commit 884ad43 plus the SQL applied to the dev and prod Supabase projects.

Legend: DONE (in code, gate green) - OWNER (only you can do it) - OPEN (code work not done) - DEFERRED (decided to wait, with the reason).

## A. Owner actions (no code)

| # | Item | Source | Status |
|---|---|---|---|
| A1 | Run `apps/web/db/setup-production.sql` in every Supabase project | ops | DONE (dev verified by query; owner reports prod done) |
| A2 | Vercel: set `TRIAL_IP_SALT` (required in production), `TRIAL_ENABLED=true`, prod Supabase URL/anon/service-role keys, `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAILS` | ops, security | OWNER |
| A3 | Supabase auth: custom SMTP (magic links and the guest "Save my work" email fail for non-team addresses without it), anonymous sign-ins on and saved, redirect URL `https://<domain>/auth/callback`, Google provider | ops | OWNER |
| A4 | Verify `select jobname from cron.job;` returns `purge-ai-payloads` and `purge-guests` in **prod** (the privacy page promises 30-day deletion) | ops | OWNER |
| A5 | Anthropic console: monthly spend limit and low-balance alert (the only backstop behind the in-app budgets) | security, perf, ops | OWNER |
| A6 | Google Cloud: publish the OAuth consent screen ("In production"); privacy and terms URLs | ops | OWNER |
| A7 | Namecheap DNS (`A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`), mailbox for the contact address | ops | OWNER |
| A8 | Decide: delete `public/logo-v5.svg` (unused, carries a C2PA blob), track or ignore `.mcp.json`, add a LICENSE | ops | OWNER |
| A9 | Later: operator name/country, `NEXT_PUBLIC_CONTACT_EMAIL`, lawyer review of `/privacy` and `/terms`, account-deletion path | ops | DEFERRED (owner: "we will update those later") |
| A10 | Click through the deployed site once: guest build then second build (banner), signed-in build, `/admin/usage`, the redesigned login and blank state in light/dark at wide and 360px | tests, a11y | OWNER (I can help debug) |

## B. Code: done

| Item | Source | Notes |
|---|---|---|
| Client-callable quota refund (unlimited calls) | sec, corr, tests | server-only release per kind; `trial_refund` capped at 1 per account, Re-simulate only |
| Failed findings refunded the build | corr, tests | `trial_release(user, action, kind)` |
| Replay of an action id returned `ok` | (manual pass) | now `quota` |
| No spend ceiling for signed-in accounts | sec, perf, ops | `TRIAL_MEMBER_DAILY_BUDGET_USD` (default $10); `TRIAL_ENABLED=false` documented as unlimited |
| `is_guest` never flipped on upgrade | corr, tests | flips on next reserve |
| IP hash default salt | sec, ops | missing `TRIAL_IP_SALT` disables the trial in production |
| No `maxDuration`; stacked SDK retries | corr, perf, ops | 300 on five routes; `maxRetries: 1` |
| Size guard trusted `content-length`; unbounded history/findings/fixes | sec, perf | measured on the received body; chat history 16, findings 50, fixes 20 |
| Findings failure dead end | corr | "Try again" in the failure sidebar |
| Slow Build overwrote a project opened meanwhile | corr | epoch guard |
| Silent failed sign-in link | corr, ops | `/login?error=link` message |
| `res.json()` on host HTML errors | corr | `.catch(() => ({}))` at 6 sites |
| No error pages | corr, ops, a11y | `error.tsx` (`retry`), `global-error.tsx`, `not-found.tsx` |
| Retention jobs not scheduled | ops | `pg_cron` block in the SQL |
| Untracked source | ops | committed |
| HSTS too long; Vercel ignores `.nvmrc`; CI lacked lint/build | ops, tests | `max-age=300`, `engines`, CI steps |
| Public status endpoint hit the DB on every visit | perf, sec, ops | CDN-cacheable 30s |
| Login email input unlabeled; login error not announced | a11y | `aria-label`, `autoComplete`, `role="alert"` |
| `.env.example` inline comments; docs gaps (SMTP, DNS, modes) | ops | rewritten |

## C. Code: open, by priority

### C1. Before or right after launch (real users would hit these) - DONE in code, second pass
Done after the first commit (see "Second pass" below); needs a browser check and, for the last bullet, a SQL re-run.
- **Accessibility blockers**: diagram nodes have a real keyboard button (`ComponentNode`, `nodesFocusable={false}`); `Modal` is a named dialog with focus in, Tab trap and focus restore (`ConfirmDialog` is an `alertdialog`); the chat popup takes focus on open, returns it on close, and Escape closes it.
- **Light-theme contrast**: `text-slate-400` to `text-slate-500 dark:text-slate-400` in 17 files; Re-simulate button `cyan-700`; failure badge dark text; the two always-dark panels lifted to `slate-400`; amber/emerald text one step darker.
- **Announcements**: `role="alert"` on build, Re-simulate, chat, explain-fix, login and banner errors and the "Save failed" button; `role="log"` on the chat list; `role="status"` on loading and "check your email"; the trial banner sits in a live region that is never re-created; labels on both email inputs; `motion-safe` on the looping animations.
- **Mobile at ~360px**: header wraps and the version menu opens inside the screen; the Google button is sized to its container; the diagram no longer traps touch scrolling (one finger scrolls, two pan/zoom); bottom padding so the chat button does not cover content; 16px inputs on phones; an `h1` on small screens; the logo is `aria-hidden` beside the wordmark.
- **`globals.css`**: border defaults moved into `@layer base` (element-level border colours now apply, so some borders will look different) and `color-scheme` set. The focus-outline rule is deliberately left unlayered and documented.
- **`projects.data` abuse**: size check (4 MB, new writes only) and a per-user row cap (3 for guests, 200 otherwise) in `projects.sql` and `setup-production.sql`. **Not yet applied to any database: re-run the SQL.**

### C2. First weeks
- **Fail-open gate**: `reserveTrial` returns no-op if the session lookup throws (proxy already authenticated). Needs mocks in five route tests.
- **Error monitoring**: `instrumentation.ts` `onRequestError` webhook or Sentry; a deeper health probe (Supabase, key present); build-time check that required env vars exist.
- **Tests and CI**: SQL execution job on throwaway Postgres (branches listed in [tests-ci](tests-ci.md) #2 plus the new ones); `reserveTrial` gating test for all five routes; proxy public-path tests (`/privacy`, `/terms`, `/api/trial/status`, `/auth/callback`); `/api/trial/me`, `status`, `health`, robots/sitemap/manifest tests; UI tests (GuestBanner states, NewProjectButton, ProjectsCard, chips); browser smoke; `npm audit`; gitleaks; `permissions`/`concurrency`/`timeout` in the workflow.
- **Cost controls**: per-action cap on model calls (worst case 20 for a build); fail closed when a model has no price (the guest budget would never trip); abort model calls when the client disconnects.
- **Security low**: hash the IPv6 /64, not the full address; anchor the proxy's public paths and matcher exclusions; unique constraint on `ai_action_outcomes`; stop logging raw model output in production (`structuredCall.ts` debug `console.error`); revoke `anon` on the two usage views; report-only CSP.
- **Reliability low**: serialize overlapping saves and treat a 0-row update as failure; `hydrateFromStorage` in try/finally and distinguish load errors from "not found"; reason-specific text for `needs-build`/`unavailable` in the trial banner; warn before a guest signs out and purge guests by inactivity.
- **Performance**: fewer auth round trips (`getClaims`, reuse the user), one `/api/trial/me` fetch that also carries `admin`; index on `ai_calls (created_at)` and `projects (user_id, updated_at desc)`; cap persisted versions/chat; warm the diagram layout library on idle.

### C3. Before charging money
Billing/credits that honour `withheld` outcomes; a public landing page; a Content-Security-Policy tested in a browser; account deletion; lawyer-reviewed legal pages; a larger live eval of the flow against the final gate (needs budget); a professional architecture review.

## Second pass (same day, after 884ad43)
See C1. Gate: typecheck clean, eslint clean, 665 tests (317 + 348, 7 new in `a11y-markup.test.tsx`, both mutation-checked), production build OK. Not seen in a browser.

## D. Hygiene noted
- `docs/orchestration/README.md` "Runs" has the short ledger; this folder has the detail.
- `packages/engine/README.md` test count fixed; keep counts in `CONTEXT.md`, `README.md`, `plans/PLAN-4.md` (currently 665 = 317 + 348).
