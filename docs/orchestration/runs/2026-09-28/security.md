# Security specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46. Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message.

**Security review: ranked findings, read-only (no files edited, no live calls, no secrets printed)**

[HIGH] apps/web/app/api/usage/outcome/route.ts:35-37 - A guest can release their own quota through the client-callable outcome endpoint, so one guest account gets unlimited AI calls.
Scenario: The guest calls `POST /api/infer {actionId:A}`, which reserves 1 build. They then call `POST /api/usage/outcome {actionId:A, reason:"withheld"}`. Because `user.is_anonymous` is true, the route calls `releaseTrialAction`, and `trial_release` (guest-trial.sql:110-114) sets `released_at` on every kind for that action. They repeat with a fresh `actionId`. The count `v_active` (guest-trial.sql:97-99) drops back to 0, so build, rework and chat run forever. The `trial_reserve` daily-budget check runs only when a new `trial_accounts` row is created (guest-trial.sql:71-79). An existing guest is never stopped by the $2 budget, so the trial's $2/day cap does not bind this account. The guest can run build, then findings and explain-fix (which need an unreleased build), then release all of it.
Fix: Delete the release from the outcome route (line 37) and its `releaseTrialAction` import. The routes already release on failure, and that includes the `ModelGateError` case. If a discarded Re-simulate must refund, do it server-side with a rate cap, for example at most 1 refund per account per kind.
Confidence: confirmed by reading code

[HIGH] apps/web/db/guest-trial.sql:71-83 and :42-48 - Signed-in accounts have no aggregate spend cap, per-IP cap or captcha. Only guests are budgeted or capped.
Scenario: `trial_spend_today` sums only `t.is_guest`, and the IP cap and budget checks sit under `if p_guest`. Every non-guest account gets a full quota (1 build, 1 rework, 5 chat, 3 findings, 3 explain-fix). A script creates magic-link accounts on a catch-all domain, or many Google accounts, and drives all of them. The only spend limit is Anthropic's own org limit. The client sends a captcha token only for `signInAnonymously` (login/page.tsx:92).
Fix: Apply a global daily budget to all users in `trial_reserve`, or a second, larger one for non-guests. Add a per-IP cap on new non-guest `trial_accounts` rows. Turn on Supabase captcha for OTP. Set an Anthropic spend limit and alert.
Confidence: confirmed by reading code. Exploitability depends on Supabase email rate limits and SMTP settings.

[MEDIUM] apps/web/lib/trial/server.ts:35,38-40 (also :49) - The quota gate fails open when the user lookup errors, and signed-in users are unlimited whenever `TRIAL_ENABLED` is not `"true"`.
Scenario: `getUser()` returns `user:null` with an error (transient Supabase Auth failure or throttling) or throws. `reserveTrial` returns `noop`, so a guest's AI call runs with no reservation. `startUsage` also returns `{}` (usage/server.ts:31), so the call is not recorded and the budget never sees it. Separately, with `TRIAL_ENABLED` unset or false, signed-in users have no limit at all (line 49). DEPLOYMENT.md:25 suggests starting with `TRIAL_ENABLED=false`.
Fix: If `!user` or on exception, return a 401/503 `denied` instead of `noop`. Consider making the unlimited case for signed-in users explicit or removing it.
Confidence: confirmed by reading code. The failure trigger is plausible only.

[MEDIUM] apps/web/db/projects.sql:9-32 - There is no size or row limit on `projects.data`, and any authenticated user, including anonymous guests, can insert via PostgREST directly.
Scenario: The anon key is public and guests are real authenticated users. A script calls `signInAnonymously`, then inserts many multi-MB jsonb rows for its own `user_id`, which RLS allows. Guests are purged only after 30 days. This can exhaust the Supabase DB quota and put the whole project into read-only mode.
Fix: Add `check (pg_column_size(data) < 1000000)` and a `before insert` trigger that caps rows per user (for example 50 for guests). Enable captcha on anonymous sign-in.
Confidence: confirmed by reading code. The quota impact is plausible.

[MEDIUM] apps/web/lib/limits.ts:84-87 with app/api/chat/route.ts:56-63, explain-fix/route.ts:21-28, rework/route.ts:37 - The size guard trusts `content-length`. Several client strings and arrays reach the prompt with no cap.
Scenario: `history`, `findings`, `pendingFixes`, `componentId`, `fixLabel`, `findingCode` and long strings inside `model` have no shape or length validation. A request with no `content-length` (chunked) skips the 200KB check. Only the component and edge array lengths are checked post-parse (limits.ts:67-73). A padded 200KB body means roughly 50k input tokens per call, multiplied by the retries and multi-call steps in the engine. `findingCode` is also stored in `ai_calls.context` (explain-fix/route.ts:45), which is kept indefinitely.
Fix: In `readJsonBody`, read the body as text and enforce `MAX_REQUEST_BYTES` on the actual length. Cap string lengths and array sizes (`history` <= N entries with a role enum, `findings`, `pendingFixes`). Truncate context values before storing.
Confidence: confirmed by reading code. The per-call cost figure is plausible only.

[MEDIUM] apps/web/lib/trial/server.ts:56 and lib/trial/policy.ts:66-69 - The IP hash falls back to a public default salt, and IPv6 clients are keyed on the full address.
Scenario: If `TRIAL_IP_SALT` is unset, the salt is the literal `"archsim-trial"`, which is in the repo. A leaked `trial_accounts` table can then be reversed over the IPv4 space, which is PII. An attacker with a /64 IPv6 range gets billions of distinct hashes and bypasses `ip-cap`. `x-forwarded-for` is trustworthy only on Vercel. On any host that does not overwrite it, the first hop is spoofable.
Fix: Throw or deny when `TRIAL_IP_SALT` is unset in production. Hash the /64 prefix for IPv6. Document the reliance on Vercel's XFF handling.
Confidence: confirmed by reading code

[LOW] apps/web/db/guest-trial.sql:59-83 - The guest budget is checked only at account creation, against spend recorded after the response.
Scenario: Costs are written via `after()` (usage/server.ts:57). Concurrent new accounts from different IPs all see spend ~ 0 and pass. Existing guests keep spending after the budget is hit, bounded only by their own quota. The overshoot is limited to the number of distinct IPs multiplied by one trial's cost.
Fix: Re-check `trial_budget_open` on every guest `trial_reserve`, not just on first registration. Reserve an estimated cost.
Confidence: confirmed by reading code

[LOW] apps/web/app/api/usage/outcome/route.ts:35 and app/api/trial/status/route.ts:11 - Unmetered writes and DB calls.
Scenario: Any user can insert unlimited `ai_action_outcomes` rows (204 each, no dedupe), which is a storage-growth vector. The unauthenticated `/api/trial/status` runs a Supabase RPC (an aggregate over `ai_calls`) on every hit with no rate limit.
Fix: Add a unique constraint on `(user_id, action_id, reason)` with `on conflict do nothing`. Cache `guestTrialOpen` for 30 to 60 seconds.
Confidence: confirmed by reading code

[LOW] packages/engine/src/inference/structuredCall.ts:342,348 - The full raw model tool input and content are logged with `console.error`.
Scenario: On a validation failure, users' architecture text and the model output go to Vercel logs. That is user content in logs, contrary to the 30-day payload-purge intent.
Fix: Log the label, attempt and lengths only, or gate the raw dump on `NODE_ENV !== "production"`.
Confidence: confirmed by reading code

[LOW] apps/web/proxy.ts:43-50 and 71-73 - The proxy's public-path checks and matcher exclusions are unanchored prefixes.
Scenario: `startsWith("/login")` and `startsWith("/auth")` also match `/loginX`. The matcher's `api/health`, `robots.txt`, `sitemap.xml`, `favicon.ico`, `_next/image` and `.*\.(png|svg|...)$` exclusions are prefix or suffix matches. No route exists under those names today, so there is no live bypass. A future route named `/api/health-x`, or with a `.png` suffix, would skip the login gate silently.
Fix: Use `pathname === "/login" || startsWith("/login/")` and the same for `/auth`. Anchor the matcher exclusions with `(/|$)`. Add a test that every `app/api/**` route path except health and trial/status is gated.
Confidence: confirmed by reading code

[LOW] apps/web/next.config.ts:4-14 - No CSP.
Scenario: The realistic XSS surface is small. There is no user HTML path, and model output renders as React text. The only `dangerouslySetInnerHTML` uses are a static theme script (app/layout.tsx:80) and JSON-LD with `<` escaped (app/login/layout.tsx:29). CSP is defence in depth only.
Fix: Add a report-only CSP first, then enforce it.
Confidence: confirmed by reading code

[LOW] apps/web/db/ai-usage.sql:93-142 - The views are created after the revoke, so default grants give `anon` SELECT on `ai_action_usage` and `ai_label_stats`.
Scenario: The underlying `ai_calls` privileges were revoked from `anon`, and `security_invoker` is on, so anon queries fail with permission denied. It is inert today but fragile.
Fix: After the views are created, add `revoke all on public.ai_action_usage, public.ai_label_stats from anon;`.
Confidence: plausible

**Checked and sound**
- `safeNextPath` and the callback: rejects `//`, `\`, control characters and whitespace, and `/login|/auth|/api`. Both the cookie and `?next=` go through it, and the result is appended to the server's own origin.
- Admin allow-list: `isAdminUser` fails closed with no default and requires a confirmed email. `requireAdmin` returns 404 and checks before any data is read. `/api/admin/status` answers about the caller only.
- SQL grants: `security definer` functions all set `search_path`, and all five are revoked from public, anon and authenticated (guest-trial.sql:130-134). The two trial tables have RLS with no policies. `ai_call_payloads` is fully revoked from anon and authenticated.
- `projects` RLS: all four policies key on `auth.uid() = user_id`. The `update` policy has no explicit `WITH CHECK`, so `USING` also applies as the check, so `user_id` cannot be reassigned.
- Quota internals: the per-user advisory lock serialises parallel reserves. The replay-returns-`quota` fix holds, and findings and explain-fix require a live build or rework. Lifetime counts apply per kind.
- Proxy gating: Next 16.3.5 uses `proxy.ts`, and a failed `getUser` redirects to login, so it fails closed. The five AI routes, outcome, and trial/me-style routes are gated. Only `/login`, `/auth`, `/privacy`, `/terms` and `/api/trial/status` are public.
- Secrets and exposure: the service-role key and `ANTHROPIC_API_KEY` are imported only in server routes and libs (engine server entrypoint). `NEXT_PUBLIC_*` holds only the Supabase URL and anon key, the Google client ID, the site URL, the contact email, the captcha flag and the hCaptcha site key. `.env*` is gitignored except `.env.example`.
- Error leakage: `upstreamError` returns a fixed message with `detail` only outside production. Prompt-injection blast radius is self-only: outputs are schema-validated tool JSON rendered as escaped React text, no model text reaches a URL, SQL or another user, and projects are RLS-private.

**Not checked**
- Live Supabase settings (email rate limits, captcha, anonymous sign-in limits, redirect allow-list) and Vercel env values. They are not readable from the repo, and `.env.local` was deliberately not opened.
- Engine prompt-construction internals beyond the route boundary, and `npm audit`, because no network or dependency scan was run.
- Client store and component logic beyond the grep for DOM sinks and redirects.
