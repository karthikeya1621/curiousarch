# Operations & deploy-readiness specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46. Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message.

**Ops and deploy readiness: ranked findings**

I only read files, and ran `npm test` (317 engine and 333 web pass). I did not run a build. I read the `error.js` docs for this Next.js version (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). In 16.3 the recovery prop is `retry()`, stable since v16.3.0. `reset()` still exists but the docs say to prefer `retry`.

**1. [HIGH] apps/web/app/api/{infer,rework,chat,identify-failures,explain-fix}/route.ts - no `maxDuration` on any AI route**
- Scenario: a build runs several sequential Sonnet calls (`fromProse.ts:157-160`, plus the topology and extended-component calls). Each call has a 90s timeout (`structuredCall.ts:166`) and one repair retry. Rework allows `maxRetries: 2` (`reworkModel.ts:511`) inside a final-gate retry (`reworkModel.ts:472-475`).
- The Anthropic client is built without `maxRetries` (`structuredCall.ts:195`), so the SDK's own retries multiply the wait.
- Total runtime can pass 60-150s, and worst case is minutes. Vercel then kills the function at the plan or Fluid default. The user sees a platform 504 or an empty response, not the friendly 502, and the guest's quota is not released because the catch block never runs.
- Fix: add `export const maxDuration = 300;` to each of the five routes (`maxDuration` is documented for route files in this version). Optionally pass a lower `maxRetries` to the Anthropic client. Update `docs/DEPLOYMENT.md:27`.
- Confidence: confirmed that no limit is set. The Vercel default and cap depend on plan and Fluid setting, which I could not verify.

**2. [HIGH] apps/web/components/LoginHero.tsx and EmptyStateAside.tsx (untracked), plus 14 modified files - the deploy source is not committed**
- Scenario: `app/login/page.tsx:9` imports the untracked `LoginHero`, and `components/Workspace.tsx:12` imports the untracked `EmptyStateAside`. `apps/web/db/setup-production.sql`, which DEPLOYMENT step 2.1 tells you to run, is also untracked.
- Vercel builds from git, so a push of HEAD (3015f46) either lacks these files or builds an older UI. The missing SQL file also breaks the setup instructions.
- Fix: commit everything intended before importing the repo into Vercel.
- Confidence: confirmed from `git status` and the import lines.
- *(Status: fixed; committed as 884ad43.)*

**3. [HIGH] docs/DEPLOYMENT.md:11-16 - custom SMTP is never mentioned**
- Scenario: sign-in by magic link (`login/page.tsx` `signInWithOtp`) and the guest upgrade (`GuestBanner.tsx` `updateUser({email})`) both send Supabase auth email.
- Supabase's built-in mailer only delivers to team members and has a very low rate limit. Public users would see "Send magic link" fail or never receive mail. Google sign-in and the guest trial still work.
- Fix: add a DEPLOYMENT step to configure custom SMTP (Resend, Postmark or similar). Add the SPF and DKIM records in Namecheap. Test with a non-team address.
- Confidence: plausible. This is external platform behaviour and cannot be seen in the repo.
- *(Status: documented; the owner still has to configure SMTP in Supabase.)*

**4. [HIGH] docs/DEPLOYMENT.md:16 and apps/web/db/ai-usage.sql:311-326, guest-trial.sql:117-134 - retention jobs only run if someone schedules them, and the SQL never does**
- Scenario: `purge_ai_call_payloads` and `purge_anonymous_users` are plain functions. `setup-production.sql` contains no `cron.schedule` and no `create extension pg_cron`. If the manual step is skipped, full prompts and responses are kept indefinitely (`AI_USAGE_LOG_PAYLOADS` defaults to on). Guest accounts and projects also pile up.
- `app/privacy/page.tsx` states 30-day deletion for both, so the published policy would be false.
- Fix: append an idempotent `create extension if not exists pg_cron;` and two `cron.schedule(...)` calls to `setup-production.sql`. Also add "verify `select * from cron.job`" to the post-deploy checklist.
- Confidence: confirmed.
- *(Status: fixed; verified on the dev project, two jobs scheduled.)*

**5. [HIGH] docs/DEPLOYMENT.md:25 and apps/web/lib/trial/server.ts:49-50 - the launch behaviour of `TRIAL_ENABLED` is undocumented, and the default is unmetered spend**
- With `TRIAL_ENABLED=false` (the `.env.example` default), guests get no access and every signed-in user is unlimited (`server.ts:49`). Sign-up is free and instant, so the only cost cap is the Anthropic console limit.
- With `TRIAL_ENABLED=true`, signed-in users get a lifetime quota of 1 build, 1 Re-simulate and 5 chat messages per account. That is intended per `docs/context/web-app-decisions.md:28`, but DEPLOYMENT never says it. Step 3 tells the operator to start with `false`, but `setup-production.sql` already includes the trial SQL.
- With it enabled and `SUPABASE_SERVICE_ROLE_KEY` missing, every non-admin user gets a 429 "The free trial isn't available right now. Please sign in." (`server.ts:50`), which is misleading for someone already signed in.
- Fix: in DEPLOYMENT, state both modes and recommend `TRUE` plus the service-role key plus the Anthropic spend cap for launch.
- Confidence: confirmed.
- *(Status: fixed in docs and `.env.example`.)*

**6. [HIGH] apps/web/app (no error.tsx, global-error.tsx, not-found.tsx or loading.tsx) - the known gap**
- Scenario: the whole app is one large client component, `Workspace` in `(app)/layout.tsx`. Any render exception shows Next's default "Application error: a client-side exception has occurred" white screen. A server error shows the default 500. A 404 from `requireAdmin()` (`lib/admin.ts:42`) shows the default unstyled 404.
- No boundary exists anywhere (`grep ErrorBoundary` is empty), and no error is reported.
- Fix, using the API in this version:
  - `app/error.tsx` with `'use client'`, props `{ error, retry }`, and a "Try again" button calling `retry()`. Log `error.digest` and offer a link to `/`.
  - `app/global-error.tsx` with its own `<html><body>`. It replaces the root layout, so it needs inline styles and no Tailwind.
  - `app/not-found.tsx` styled to match the app.
  - `error.tsx` at `app/` also covers the `(app)` layout, since the root layout is above it.
- Confidence: confirmed. Severity is high for a launch with unmonitored errors.
- *(Status: fixed.)*

**7. [MEDIUM] apps/web/lib/trial/server.ts:56, lib/trial/policy.ts and .env.example:22 - the IP hash salt falls back to a public constant**
- Scenario: if `TRIAL_IP_SALT` is unset, the salt is `"archsim-trial"`, and `.env.example` ships `change-me`. Hashing IPv4 addresses with a known salt is trivially reversible from a DB dump or service-key access. That contradicts the privacy page's "we do not store the address".
- Fix: in production, treat a missing or short salt as `unavailable()` and log loudly. Mark the variable "required when TRIAL_ENABLED".
- Confidence: confirmed.
- *(Status: fixed for a missing salt; a short salt is still accepted.)*

**8. [MEDIUM] Observability - there is no error monitoring, and Vercel log retention is short**
- Scenario: `console.error` in `lib/apiRoute.ts:42`, `lib/trial/server.ts:72,81,94` and `lib/usage/*` is the only signal. Vercel runtime logs are kept for about an hour on Hobby and a day on Pro.
- Nothing is pushed for an invalid Anthropic key, exhausted credit, a Supabase outage or an exhausted guest budget.
- Fix:
  - Add `instrumentation.ts` with an `onRequestError` hook that POSTs to a Slack or Discord webhook (with rate limiting), or add Sentry.
  - Add a Vercel log drain.
  - Set the Anthropic console low-balance alert.
- Confidence: confirmed that none exists.

**9. [MEDIUM] packages/engine/src/inference/structuredCall.ts:188-193 - a missing `ANTHROPIC_API_KEY` is invisible to the operator**
- Scenario: the key check throws before any `emit()`, so no `ai_calls` failure row is written. `/admin/usage` "recent failures" stays empty and users get a generic 502. An invalid key does throw inside `create` and is recorded.
- Fix: in `startUsage`, or a build-time check, fail loudly when the key is absent. See item 10.
- Confidence: confirmed.

**10. [MEDIUM] apps/web/next.config.ts and proxy.ts:19-20 - required variables are never validated at build**
- Scenario: `NEXT_PUBLIC_*` values are inlined at build. A missing Supabase URL or anon key yields a throw in `proxy.ts` on every request, or a broken browser bundle. Adding the variable later needs a redeploy.
- A missing `NEXT_PUBLIC_SITE_URL` silently falls back to the `*.vercel.app` URL (`lib/site.ts:21-26`), or to `localhost:3000` off Vercel. Canonical URLs, the sitemap and social cards would then point at the wrong origin.
- Fix: in `next.config.ts`, throw when `VERCEL_ENV === "production"` and any of `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset.
- Confidence: confirmed.

**11. [MEDIUM] apps/web/app/api/trial/status/route.ts:11-13 - a public endpoint runs an aggregate query on every call**
- Scenario: each `/login` load calls `guestTrialOpen`, which runs `trial_budget_open` and `trial_spend_today`. That is a `SUM` over today's `ai_calls` joined to `trial_accounts`, with no index on `created_at` alone (`ai-usage.sql:23-49`).
- Unauthenticated, unmetered and `no-store`, so a scripted loop can load the database.
- Fix: cache the answer for 30-60s in-process, or use `revalidate`. Add `create index on ai_calls (created_at)`.
- Confidence: confirmed by reading the code. The load impact is plausible.
- *(Status: response is now CDN-cacheable for 30s; no index added.)*

**12. [MEDIUM] apps/web/app/auth/callback/route.ts:18-21 - a failed sign-in exchange is silent**
- Scenario: the result of `exchangeCodeForSession` is ignored. Magic links use PKCE, so opening the email on another browser or device fails, as does an expired or reused link. The user is redirected to `/`, then by the proxy to `/login` with no message, and probably retries into the SMTP rate limit.
- Fix: check `error`. Redirect to `/login?error=link` and show "That sign-in link expired or was opened on a different device. Request a new one."
- Confidence: confirmed.
- *(Status: fixed.)*

**13. [MEDIUM] apps/web/app/api/health/route.ts and the Supabase plan - the health check is too shallow, and a free-tier project pauses**
- Scenario: `/api/health` always returns `ok` and touches nothing, so it cannot detect a Supabase outage, a bad key or a paused project. A free-tier Supabase project pauses after a week of inactivity, and uptime pings to `/api/health` do not wake it.
- Fix: add a second probe, such as `/api/health/deps` gated by a secret header. It should make a cheap Supabase call (an rpc or `select 1`), and its check should confirm the Anthropic key is present without spending. Use Supabase Pro for backups (`DEPLOYMENT.md:17`). Otherwise take manual backups and accept the pause risk.
- Confidence: plausible for the Supabase plan behaviour.

**14. [MEDIUM] apps/web/app/privacy/page.tsx, components/LegalPage.tsx:28-36 and site.ts - the contact email and account deletion**
- Scenario: `NEXT_PUBLIC_CONTACT_EMAIL` is only "needed" in DEPLOYMENT. If it is unset, the page says "use the contact address published on our website", and none is published. There is also no self-serve account deletion, only "ask us" by email.
- Fix: make the contact variable required (see item 10) and set it before launch. Add a mailbox to Namecheap. Plan account deletion as a follow-up.
- Confidence: confirmed.
- *(Status: open; the owner deferred the legal update.)*

**15. [MEDIUM] apps/web/next.config.ts:13 - HSTS is `includeSubDomains` with a 2-year max-age**
- Scenario: if the apex domain has any subdomain without HTTPS (mail, a staging host, Namecheap parking), browsers are locked out of it for two years.
- Fix: start with `max-age=300` and no `includeSubDomains`, then raise it once all subdomains are confirmed HTTPS.
- Confidence: confirmed that the header is set. The impact depends on your DNS.
- *(Status: fixed.)*

**16. [MEDIUM] docs/DEPLOYMENT.md:3 and .nvmrc - Vercel does not read `.nvmrc`**
- Vercel uses the project's Node setting or `engines.node` in the root-directory `package.json`. Neither `apps/web/package.json` nor the root `package.json` has `engines`. The `>=24` only appears in `packages/engine/package.json`.
- Result: CI runs Node 24 but Vercel may build on 20 or 22. `next.config.ts` uses `import.meta.dirname` (Node 20.11+), so it still works, but the environments differ.
- Fix: add `"engines": {"node": "24.x"}` to `apps/web/package.json`, or set the Vercel Node version to 24. Correct the docs.
- Confidence: plausible (Vercel behaviour, not verifiable here).
- *(Status: fixed.)*

**17. [MEDIUM] .github/workflows/ci.yml:21-23 - CI never runs lint or `next build`**
- The first real build happens on Vercel. `npm run typecheck` does not catch Turbopack resolution problems, which the `packages/engine/src/index.ts` comment says have been a real issue with `.ts` extensions.
- Fix: add `npm run lint --workspace web` and `npm run build --workspace web` (with dummy `NEXT_PUBLIC_*` values) to the workflow.
- Confidence: confirmed.
- *(Status: fixed.)*

**18. [LOW] docs/DEPLOYMENT.md:29-35 - Namecheap DNS and Google OAuth details are missing**
- Missing: the apex A record and the `www` CNAME to Vercel, the choice of canonical host, and adding both hosts to Supabase redirect URLs and Google origins (`DEPLOYMENT.md:14,20`). The Google OAuth consent screen must be set to "In production", or only listed test users can sign in.
- Fix: add these lines.
- Confidence: plausible.
- *(Status: fixed in docs.)*

**19. [LOW] apps/web/public/logo-v5.svg:1 - an unused file with a C2PA provenance blob is publicly served**
- The proxy matcher excludes `.svg`, so the file is served at `/logo-v5.svg`. Nothing references it except a comment in `Logo.tsx:4`.
- Also in `public/`: the unused Next boilerplate `file.svg`, `globe.svg`, `next.svg`, `vercel.svg` and `window.svg`.
- Fix: `git rm` `logo-v5.svg` (keep the source elsewhere) and the boilerplate files.
- Confidence: confirmed.
- *(Status: boilerplate removed; `logo-v5.svg` left for the owner to decide.)*

**20. [LOW] packages/engine/README.md:7 - the engine README says "145 tests"**
- The real count is 317. The root README and `CONTEXT.md` (650 = 317 + 333) are correct. `DEPLOYMENT.md:24` says Vercel runs `npm ci`; its default install is `npm install`. `apps/web/README.md` still calls the env list partial, though it defers to `.env.example`.
- Confidence: confirmed.
- *(Status: engine README count fixed.)*

**21. [LOW] .mcp.json:8 and no LICENSE**
- `.mcp.json` is tracked and exposes the dev Supabase project ref. It is not a secret and it is read-only, but confirm the repo is meant to be public. The repo has no LICENSE file.
- Fix: gitignore `.mcp.json`, add a license, or make the repo private.
- Confidence: confirmed.

**22. [LOW] apps/web/lib/trial/server.ts:38-39 - the quota check fails open when `getUser()` throws**
- During a Supabase auth blip, a signed-in or guest request skips the quota and also skips usage recording, so the AI call runs uncounted and untracked. The window is small, and the Anthropic cap still applies.
- Fix: return `unavailable()` on error, or log the event.
- Confidence: confirmed.

**23. [LOW] .env.example - inline `# comments` after values**
- If the file is pasted into Vercel's bulk import, `NEXT_PUBLIC_SITE_URL` could absorb the comment text.
- Fix: put comments on their own lines. Also note that `STRUCTURED_CALL_DEBUG` (`structuredCall.ts:341,347`) prints raw model output and user content to the logs and must never be set in production.
- Confidence: plausible.
- *(Status: fixed.)*

**Checked and sound**
- **Env reads:** every `process.env` read has a documented `.env.example` entry, except the `STRUCTURED_CALL_DEBUG`, `EVAL_*` and Vercel system variables. `ADMIN_EMAILS` fails closed. The service-role client is server-only. Payload logging can be turned off.
- **Vercel `after()`:** usage writes run in `after()` with a fallback (`lib/usage/server.ts:57`). It is supported on Vercel, and the writes can be lost if the function is killed.
- **Monorepo resolution:** `turbopack.root` is pinned to the repo root. The engine is bundled from source through explicit `.ts` imports, so no `transpilePackages` is needed, and a `.next` build exists.
- **Body-size guard:** the 200KB limit (`limits.ts:MAX_REQUEST_BYTES`) plus the model-shape guard are well below Vercel's 4.5MB limit.
- **SEO:** `metadataBase` comes from `siteUrl()`, and the login, privacy and terms pages are indexable while the app is noindex. The robots, sitemap and manifest routes are excluded from the proxy. The JSON-LD escapes `<`. Social images are static PNGs, which the matcher excludes.
- **Error responses:** engine failures return a friendly 502 or 422 and hide the detail in production (`apiRoute.ts:42-45`).
- **SQL:** `trial_reserve` uses an advisory lock and revokes execution from the public roles. `setup-production.sql` matches `projects.sql` + `ai-usage.sql` + `guest-trial.sql` plus headers only. `purge_anonymous_users` cascades to projects.
- **Repo hygiene:** `.env.local` and the tsbuildinfo file are gitignored and untracked. No secrets are tracked. The Next.js version is pinned at 16.3.5, the lockfile is present, and `.nvmrc` is 24.

**Not checked**
- I did not run `next build` or lint, because the build writes `.next` and the review is read-only.
- I did not check the live Vercel plan and Fluid duration limits, Supabase SMTP behaviour, the exact Vercel install command, or Anthropic rate limits.
- I did not assess Namecheap DNS.
- Contrast, keyboard and other accessibility issues are for the other specialists.

**Go / no-go for a first free launch**

NO-GO as the repo stands, but the gaps are quick to close. There is no design blocker.
- Must-do before the first public request:
  1. Commit the untracked `LoginHero.tsx`, `EmptyStateAside.tsx` and `setup-production.sql` (item 2).
  2. Add `maxDuration = 300` to the five AI routes so builds and Re-simulates are not cut off mid-flight (item 1).
  3. Configure custom SMTP so email sign-in works (item 3).
  4. Schedule both purge jobs so the privacy policy is true (item 4).
  5. Set `TRIAL_ENABLED=true` with the service-role key and a strong `TRIAL_IP_SALT`, and set the Anthropic spend cap (items 5 and 7).
  6. Add `error.tsx`, `global-error.tsx` and `not-found.tsx` (item 6).
- Strongly recommended in the first week: an error webhook or Sentry, and the build-time env guard (items 8 and 10). The `/login` error message, contact email, lower HSTS and CI build step are also worth doing early (items 12, 14, 15 and 17).
- The rest is backlog.
