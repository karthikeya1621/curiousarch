# Tests & CI specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46. Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message. **The SQL test job, route-gating tests, proxy public-path tests and UI tests below are still open.**

## Gate results (run at repo root, offline)
- `npm run typecheck` passed (exit 0, engine and web).
- `npm run lint --workspace web` passed (exit 0, no warnings printed).
- `npm test` passed with exit 0: engine 14 files / 317 tests, web 25 files / 333 tests, so 650 in total. No test fails, and none asserts old copy.
- The stack-trace-like lines in the output are expected logs from four error-path tests. Each is a `console.error("[api] upstream failure: ...")` from `upstreamError` (`lib/apiRoute.ts`), and each of those tests asserts a 502 or a release:
  - `chat.test.ts:214`
  - `rework.test.ts:138`
  - `explain-fix.test.ts:117`
  - `trial-routes.test.ts:47`
- I did not run `npm audit` or `next build`.
- One thing to know: `.next/` already holds a build from 17:20 today, so a build was run earlier, but nothing in CI or in these tests proves it still works after the login and blank-state edits.

## Ranked findings

**1. [HIGH] Quota bypass through release semantics; untested**
- Where: `apps/web/app/api/usage/outcome/route.ts:37`, `apps/web/db/guest-trial.sql:110-114`, `apps/web/app/api/identify-failures/route.ts:37`
- Scenario A: a guest builds with action id A, then POSTs `/api/usage/outcome {actionId:A, reason:"withheld"}`.
  - The route calls `releaseTrialAction`, which calls `trial_release(user, A)`.
  - `trial_release` sets `released_at` on every kind under A and never checks that the result was really withheld.
  - The build stops counting, and the guest can build again. The same works for chat messages.
  - This contradicts "the client is never trusted with the count" in `docs/context/web-app-decisions.md:23`.
- Scenario B (no attacker needed): a build and its findings call share one action id (`ProseInput.tsx:45,59`, then `findings.ts:52` via `modelSlice.ts:104`).
  - If the findings call fails, the route runs `gate.release()`, which refunds the successful build as well.
- Fix:
  - Make `trial_release` take `p_kind` so each caller releases only its own row.
  - Have `outcome` accept "withheld" for `rework` or `build` only.
  - Ideally require server-side evidence, such as a matching `ai_calls` outcome.
- Test cases to add:
  - "outcome route: an anonymous user's `withheld` releases only kind build/rework".
  - "identify-failures failure releases only findings, not the build".
  - The `usage.test.ts:248-290` mock user has no `is_anonymous`, so the release branch is never exercised.
  - SQL test: reserve build A, reserve findings A, release findings A, and assert the build is still active.
- Confidence: confirmed by reading code. I did not run it against a database.
- *(Status: fixed; the route and unit tests for release-by-kind were added, the SQL and outcome-route tests were not.)*

**2. [HIGH] The SQL that enforces the money limit has never run**
- `trial-server.test.ts` mocks `rpc()` completely, so `trial_reserve`, `trial_release`, `purge_anonymous_users` and `trial_spend_today` have zero executed coverage.
- Branches that need a test (`guest-trial.sql`):
  - Line 72: `needs-build` for a brand-new account, and that no row is inserted.
  - Lines 74-78: `ip-cap` counts only guests created today (UTC), and a non-guest never hits it.
  - Line 79: `budget` refuses only when the account is new.
  - Line 81: the first use inserts a `trial_accounts` row with the right `is_guest`.
  - Line 88: replaying an id that is still counted returns `quota`.
  - Lines 90-95: `needs-build` when only released builds exist.
  - Lines 97-99: `quota` at exactly the limit, per kind, with released rows excluded.
  - Lines 101-102: re-reserving a released id un-releases it and does not violate `unique(user_id, action_id, kind)`.
  - Line 69: the advisory lock, tested with two concurrent `psql` sessions issuing 6 chat reserves and expecting exactly 5 ok.
  - `trial_release` on an unknown or already released id is a no-op.
  - `trial_spend_today` counts only guests and only today.
  - `purge_anonymous_users` deletes only anonymous users older than N days, plus their `trial_*` rows.
  - Lines 130-134: `revoke` really blocks the `anon` and `authenticated` roles from calling these.
- How to run: plain `postgres:16` in Docker with stubs for `auth.users` and the roles, or pgTAP. The CI YAML is below.
- `setup-production.sql` is currently in sync with the three sources (one blank-line difference), but nothing enforces that.
- Confidence: confirmed by reading code.
- *(Status: open. Line numbers refer to the pre-fix file; the new branches (`trial_refund`, member budget, `is_guest` flip) need cases too.)*

**3. [HIGH] The changed UI is untested and has never been in a browser**
- These have no test at all:
  - `app/login/page.tsx`, `components/LoginHero.tsx`, `EmptyStateAside.tsx`
  - `GuestBanner.tsx` (guest, non-guest and limit-hit states, `Save my work` form, `updateUser` failure)
  - `NewProjectButton.tsx` (limited: disabled with the guest or free title; blank: null)
  - `ProseInput.tsx` (example chips, trial-limit path)
  - the `Workspace.tsx` blank and non-blank branch
  - `ProjectsCard hideWhenEmpty`
  - `useTrialStatus`
- The existing component tests use `renderToStaticMarkup` (`rework-warning.test.tsx`), which works for markup but cannot click chips.
- Cases to add, static markup first:
  - "GuestBanner renders nothing when `!limited`".
  - "GuestBanner guest resting state shows Save my work and the trial copy".
  - "GuestBanner non-guest never shows an email form".
  - "NewProjectButton is disabled and titled for limited users, and null when blank".
  - "ProjectsCard hideWhenEmpty returns null with 0 projects".
  - "Workspace blank state renders ProseInput and no ChatWidget".
- For interaction, either add jsdom and Testing Library or use the Playwright smoke test below. The chips need a click test: they should fill the textarea and not submit.
- Confidence: confirmed by reading code.

**4. [MEDIUM] Route gating is tested for `/api/infer` only**
- `trial-routes.test.ts:19` imports only `app/api/infer/route.ts`.
- `chat`, `rework`, `identify-failures` and `explain-fix` each call `reserveTrial(request, body, kind)`, at `chat/route.ts:66`, `rework/route.ts:39`, `identify-failures/route.ts:30` and `explain-fix/route.ts:40`.
- Nothing asserts the kind. Changing `"rework"` to `"build"`, or dropping a gate, still passes.
- Cases: `it.each` over the 5 routes asserting:
  - the reserved kind is correct;
  - a denied gate never calls the engine;
  - an engine failure calls `release`;
  - an invalid body never reserves.
- Confidence: confirmed by reading code.

**5. [MEDIUM] The proxy's public-path rule is untested**
- `login-next.test.ts:82-115` covers `/`, `/project/...`, `/api/chat` and `/login`.
- Nothing runs `proxy()` for `/privacy`, `/terms`, `/api/trial/status` or `/auth/callback` when signed out.
- `site-seo.test.ts:22-25` only tests the matcher regex ("still runs on /api/trial/status"). It passes even if the allowlist in `proxy.ts:47-53` is deleted, so it would not catch a regression that makes the terms page redirect to login.
- Also, the test builds `new RegExp('^'+matcher+'$')`, which approximates Next's matcher syntax rather than using it.
- The matcher's `api/health` is a prefix exclusion, so any future `/api/health*` route bypasses the proxy.
- Cases: `it.each(["/privacy","/terms","/api/trial/status","/auth/callback"])("signed-out: no redirect")`.
- Confidence: confirmed by reading code.

**6. [MEDIUM] No tests for these endpoints or outputs**
- `/api/trial/me` (`route.ts:11-25`):
  - the admin-not-limited case;
  - the guest case;
  - `limited` follows `TRIAL_ENABLED` for a signed-in user;
  - a throw gives `{limited:false}`;
  - `no-store` is set.
- `/api/trial/status`: the boolean-only body, and that `captcha` is passed through.
- `/api/health`: a 200 `{status:"ok"}` with `no-store`.
- `robots.ts`, `sitemap.ts`, `manifest.ts`: disallow `/api/`, `/project/`, `/admin/` and `/auth/`, the sitemap lists only the three public URLs, and the manifest icons exist under `public/`.
- A `site-seo` test has a case for `siteUrl` only.
- Confidence: confirmed by reading code.

**7. [MEDIUM] CI is typecheck and test only**
- Missing pieces:
  - lint;
  - `next build`;
  - SQL execution and a bundle-drift check;
  - `npm audit`;
  - secret scan;
  - browser smoke;
  - `permissions:`, `concurrency` and `timeout-minutes`.
- Any of lint, build or the smoke test would have caught a broken login or blank-state edit made after the last green run.
- The proposed YAML is below.
- Confidence: confirmed by reading code.
- *(Status: lint and build added to `.github/workflows/ci.yml`; the rest is open.)*

**8. [MEDIUM] `is_guest` never flips on upgrade**
- `guest-trial.sql:24,81`: `is_guest` is set only when the row is first inserted.
- After a guest adds an email and `updateUser` succeeds, `trial_reserve` finds the existing row.
- The upgraded user's spend still counts toward the guest daily budget (`trial_spend_today`, line 45) and toward the per-IP cap for that day.
- Their spend can close the guest option for everyone.
- Not covered by any test, and the upgrade-then-reserve flow needs a SQL test.
- Fix: update `is_guest` to `p_guest` on the reserve path when it differs.
- Confidence: confirmed by reading code (the effect on real Supabase `is_anonymous` after email confirm is not verified).
- *(Status: fixed in SQL; no SQL test.)*

**9. [LOW] Weak tests (spot-checked by reasoning)**
- `site-seo.test.ts` "still runs on /api/trial/status" passes with the allowlist removed (see finding 5).
- `trial-policy.test.ts:8-15` restates constants, so it is a change-detector and not a behaviour test.
- `trial-routes.test.ts:35` asserts the mock's `calls[0][2]`, which is implementation-coupled.
- `trial-server.test.ts` sets `process.env` in `beforeEach` and never restores it. Vitest isolates per file, so this is harmless today.
- `layout-roots.test.ts` is named for something else: it tests `layoutModel`.
- The four expected error-path logs are noisy. Wrapping each of those tests in `vi.spyOn(console,"error")` would also let them assert the log.
- Confidence: confirmed by reading code.

**10. [LOW] Client behaviour is untested**
- The full-reload sign-in and sign-out `window.location.assign` calls (`login/page.tsx:99,135`) have no test.
- `startGuest` with `captchaToken` has no test.
- The `res.json().catch(() => ({}))` fallback added in 5 files (host HTML error) has no test. A case like "502 with an HTML body shows the friendly message" would cover it for one of them (`store.test.ts` style).
- Confidence: confirmed by reading code.

## Proposed CI additions

**Upgrade to `.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions: { contents: read }
concurrency: { group: "ci-${{ github.ref }}", cancel-in-progress: true }
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: ".nvmrc", cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint --workspace web
      - run: npm test
      - name: setup-production.sql contains its three sources
        run: |
          for f in projects ai-usage guest-trial; do
            python3 - "$f" <<'PY'
          import re, sys
          n = lambda s: re.sub(r"\s+", "", s)
          src = open(f"apps/web/db/{sys.argv[1]}.sql").read()
          sys.exit(0 if n(src) in n(open("apps/web/db/setup-production.sql").read()) else 1)
          PY
          done
  build-and-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:  # placeholders, not secrets
      NEXT_PUBLIC_SUPABASE_URL: https://ci.invalid
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ci
      NEXT_PUBLIC_SITE_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: ".nvmrc", cache: npm }
      - run: npm ci
      - run: npm run build --workspace web
      - run: npx playwright install --with-deps chromium
      - run: |
          npm run start --workspace web &
          npx wait-on -t 60000 http://localhost:3000/api/health
          curl -fsS localhost:3000/robots.txt | grep -q "Disallow: /api/"
          curl -fsS -o /dev/null -w '%{http_code}' localhost:3000/privacy | grep -q 200
          curl -fsS -o /dev/null -w '%{http_code}' localhost:3000/terms | grep -q 200
          # signed-out deep link must land on /login?next=
          curl -s -o /dev/null -w '%{redirect_url}' localhost:3000/project/x | grep -q '/login?next=%2Fproject%2Fx'
          node apps/web/scripts/smoke.mjs   # new: Playwright loads /login and asserts "Sign in" and the Terms/Privacy links, no page errors
  sql:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      pg:
        image: postgres:16
        env: { POSTGRES_PASSWORD: ci }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 10
    env: { PGPASSWORD: ci }
    steps:
      - uses: actions/checkout@v4
      - run: |
          P="psql -h localhost -U postgres -v ON_ERROR_STOP=1"
          $P -c "create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), is_anonymous boolean default false, created_at timestamptz default now(), email text); create role anon; create role authenticated; create role service_role;"
          $P -f apps/web/db/setup-production.sql
          $P -f apps/web/db/setup-production.sql          # idempotent re-run
          $P -f apps/web/db/tests/trial.sql               # new: DO blocks that raise on any wrong answer (the branches in finding 2)
  audit:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: ".nvmrc", cache: npm }
      - run: npm audit --omit=dev --audit-level=high
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```
- `apps/web/scripts/smoke.mjs` and `apps/web/db/tests/trial.sql` do not exist yet.
- The `sql` job's stubs assume `ai-usage.sql` only needs `auth.users`, roles and `pgcrypto`. Check that first, or use a `supabase/postgres` image pinned to a tag.
- `next start` may need `SUPABASE_*` values to boot, so verify before relying on the smoke job.
- (Note added after the fact: `setup-production.sql` now also runs a `pg_cron` block; in plain Postgres it raises a NOTICE and continues, so the job still passes.)

## Checked and sound
- `trial_reserve` design: the advisory lock serializes per user, and `select ... into` on no row yields null, so `v_found` acts as false.
- `reserveTrial` fails closed for guests (`server.ts:47-50,71-74`) and never limits admins.
- The `trial_*` tables have RLS enabled with no policies, and the functions revoke access from `anon` and `authenticated`.
- The ip-cap and budget checks run only when a new guest account is created.
- The client never sends a count or a user id (`outcome/route.ts:35` uses the session user).
- `trialConfig` parsing and the IP hashing (`policy.ts`) are well tested.
- The `refusal` wording for guest versus non-guest is tested.
- The auth callback's open-redirect protection (`safeNextPath`) has extensive tests.
- The proxy matcher test covers the crawler, manifest, health and icon paths.
- `opengraph-image.png` and `twitter-image.png` are served with a `.png` extension (per the earlier build's route manifest), so the matcher's extension exclusion covers them.
- Typecheck, lint and tests are green.
- The Node version matches (`.nvmrc` 24, local v24.15.0).

## Not checked
- `next build` and `npm audit`: not allowed or not run.
- Live browser behaviour: no browser run.
- Real-database behaviour of `trial_*` and Supabase `is_anonymous` after email confirm.
- Whether Vercel needs env vars for `next start` in the smoke job.
- The store slices and the engine's own 317 tests were not reviewed beyond a green run.
