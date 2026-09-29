# Performance & cost specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46. Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message.

**Performance & cost findings, ranked.** Read-only review. I made no live AI calls and no rebuild. I inspected the existing `.next` build for chunk sizes.

**[impact high] apps/web/lib/trial/server.ts:49 and apps/web/db/guest-trial.sql (`trial_reserve`, `trial_spend_today`) - Signed-in accounts have no effective spend ceiling.**
- Scenario:
  - With `TRIAL_ENABLED` unset or false, `if (!config.enabled && !guest) return noop` skips the quota entirely, so any magic-link account gets unlimited Sonnet calls. docs/DEPLOYMENT.md:25 suggests starting with it false.
  - With it true, the per-IP cap and the daily budget apply only when `p_guest` is true, and `trial_spend_today` sums guest accounts only. Free email accounts are unlimited in number, each with its own quota.
  - The repo measures $0.06-0.08 for build + chat + Re-simulate on large systems (docs/context/live-testing-log.md). Findings cost is not measured anywhere.
- Fix:
  - Launch with `TRIAL_ENABLED=true`.
  - Apply the daily budget to all accounts by dropping the `is_guest` filter and checking it for non-guests at reserve time.
  - Set a spend limit on the Anthropic workspace.
- Confidence: confirmed by reading code and SQL.

**[impact high] apps/web/app/api/{infer,rework,identify-failures,chat}/route.ts - No `maxDuration` on any AI route.**
- Scenario:
  - docs/DEPLOYMENT.md:27 says to set it, but a grep of `app/` finds none.
  - A Build is a serial chain: topology in parallel with workload, then coverage, then an optional second draft, then extended components. The whole chain repeats if the final gate fails (`fromProse.ts:157-164`).
  - The `fromProse.ts` comment says a single topology call ranges from 4 to 60s.
  - If the platform kills the function mid-chain, `gate.release()` in the catch block never runs, so a guest's only build stays counted. The Anthropic calls are still billed.
- Fix: `export const maxDuration = 300` (or whatever the plan allows) on those four routes, and verify it against the Vercel plan.
- Confidence: no-`maxDuration` confirmed. The timeout behaviour on Vercel is plausible and depends on the plan.

**[impact medium] packages/engine/src/inference/structuredCall.ts:195 - Anthropic SDK retries are stacked under the structured retries.**
- Scenario:
  - `new Anthropic({ apiKey, timeout: 90_000 })` leaves `maxRetries` at the SDK default of 2 (`node_modules/@anthropic-ai/sdk/client.js:112`). One slow or overloaded attempt can take up to 3 x 90s = 270s.
  - `onCall` only sees the final error (line 311), so retried attempts are invisible to usage tracking.
- Fix: pass `maxRetries: 1`, or 0 with the existing repair loop as the only retry.
- Confidence: confirmed by reading code.

**[impact medium] apps/web/lib/limits.ts:84-87, apps/web/lib/apiRoute.ts:12, apps/web/lib/limits.ts:67-73 - The size guard can be bypassed and does not bound prompt tokens.**
- Scenario:
  - `isRequestTooLarge` reads the `content-length` header and treats a missing one as 0. A chunked request skips the 200 KB cap.
  - `isValidModelShape` checks only array lengths, not string sizes.
  - A crafted model goes to Sonnet whole: rework sends `JSON.stringify(baseView(model))` on up to 3 base attempts and again on the second gate pass (`reworkModel.ts:507`), and `identifyFailures` does the same.
  - 200 KB is about 50k tokens, roughly $0.10 of input per attempt. That is many times the nominal cost of a legitimate action, even inside quota.
  - `chat/route.ts:56-58` passes `history` with no length or element validation. `pendingFixes` (`rework/route.ts:37`, `chat/route.ts:63`) is uncapped in length and string size.
- Fix:
  - Read `await request.text()`, check its length, then `JSON.parse`.
  - Cap the serialized model (for example 60 KB) and per-field lengths.
  - Cap `history` at 16 entries and `pendingFixes` at 10, with bounded strings.
- Confidence: confirmed by reading code. The dollar figure is an estimate from token counts.

**[impact medium] packages/engine/src/inference/fromProse.ts:156-224, reworkModel.ts:464-598 - No per-action call budget.**
- Scenario:
  - Typical Build is 4 calls plus 1 findings call (topology, workload on Haiku, coverage on Sonnet, extended). Typical Re-simulate is 2 Sonnet calls (base and revise) plus findings.
  - The revise call at `reworkModel.ts:559` is unconditional, even with no extended components and nothing queued.
  - Worst case is bounded but large: Build up to 20 calls (2 passes x 5 steps x 2 attempts), Re-simulate up to 12 Sonnet calls (2 passes x (3 base + 3 revise) attempts).
  - Each call has `max_tokens` 8192, about $0.08 of output ceiling, and every repair resends the whole input plus the prior output.
  - Coverage measured at +$0.006 per build, +$0.01 when it triggers a second draft (docs/context/inference-reliability.md:29).
- Fix: a shared counter in `StructuredCallOptions` that refuses a new `messages.create` past N calls per action (for example 10 for Re-simulate, 14 for Build). This is a structural cap, not a judgment.
- Confidence: confirmed by reading code. Worst-case counts are computed from the loops.

**[impact medium] apps/web/proxy.ts:39, apps/web/lib/trial/server.ts:30, apps/web/lib/usage/server.ts:28 - Up to three sequential Supabase Auth round trips before every AI call.**
- Scenario:
  - Each of the three calls `auth.getUser()`, which is a network call to Supabase Auth. `reserveTrial` and `startUsage` also each build their own server client. `reserveTrial` returns early for admins, so admins pay two.
  - Page load adds more: the proxy on `/` plus `/api/trial/me` twice plus `/api/admin/status` is about 7 Auth calls and 3 function invocations.
- Fix:
  - Use `supabase.auth.getClaims()` in the route helpers. It is available in auth-js 2.116 and verifies the JWT locally when the project uses asymmetric signing keys.
  - Or have the proxy forward the verified user id in a request header that it sets itself, overwriting any client-supplied value.
  - Have `startUsage` reuse the user that `reserveTrial` already resolved.
- Confidence: confirmed by reading code. The latency saving is plausible and not measured.

**[impact medium] apps/web/lib/trial/server.ts:99-110, apps/web/app/api/trial/status/route.ts:11, apps/web/db/guest-trial.sql (`trial_spend_today`) - The unauthenticated login-page endpoint runs a join-and-sum on every visit.**
- Scenario:
  - `/api/trial/status` is public and `no-store`. Each call runs `trial_budget_open`, which runs `trial_spend_today`. That function joins `trial_accounts` (guests, kept 30 days) to `ai_calls` filtered on `created_at >= today`.
  - `ai_calls` has no index on `created_at` alone (indexes are at `db/ai-usage.sql:51-54`), so cost grows with guest count. It doubles as an unauthenticated DB load amplifier.
- Fix:
  - Memoize `guestTrialOpen()` in module memory for 30-60s, and send `s-maxage=30, stale-while-revalidate` instead of `no-store`.
  - Optionally add an index on `ai_calls (created_at)`.
- Confidence: confirmed by reading code and SQL. Actual load is plausible and not measured.

**[impact medium] apps/web/lib/useTrialStatus.ts:19, apps/web/components/NewProjectButton.tsx:30, apps/web/components/GuestBanner.tsx:15, apps/web/components/AdminUsageLink.tsx:20 - Redundant client fetches on every load.**
- Scenario:
  - Two components each call `useTrialStatus`, so there are two `/api/trial/me` requests per mount.
  - `NewProjectButton` remounts with `ProjectsCard` when the canvas switches between blank and non-blank (`Workspace.tsx:143` versus `:167`), so it fetches again.
  - `AdminUsageLink` fires `/api/admin/status` for every user, and it is almost always false.
- Fix:
  - Fetch once into the store or a module-level promise.
  - Add `admin` to the `/api/trial/me` response and delete `/api/admin/status` from the header.
  - Together with the auth fix above this takes page load from about 7 Auth calls to about 2.
- Confidence: confirmed by reading code.

**[impact low] apps/web/lib/sessionStorage.ts:149-153, apps/web/lib/store/slices/versionsSlice.ts:6-10, apps/web/components/AutoSaveIndicator.tsx:16 - The saved project row grows without bound and is rewritten whole.**
- Scenario:
  - `versions` only grows, and each `Version` holds a full model and its findings. `baselineModel` and the full `chatMessages` transcript are persisted too, though only 8 messages are ever sent.
  - Every save debounced 1.5s after a revision bump rewrites the entire `data` jsonb.
  - The free quota (1 build, 1 Re-simulate) bounds this at launch. It bites once credits exist or the quota is off.
- Fix: keep only the last N versions (about 20), and cap persisted chat at about 100 messages.
- Confidence: growth confirmed by reading code. Size is plausible and not measured.

**[impact low] apps/web/components/ProjectsCard.tsx:43-45, apps/web/lib/sessionStorage.ts:215-219, apps/web/db/projects.sql:20 - The project list is refetched after every save, with no limit or composite index.**
- Scenario: every autosave costs an update plus a select on `lastSavedAt`. The list query has no `LIMIT` and sorts in memory (the only index is on `user_id`).
- Fix: patch the list locally after a save, add `.limit(50)`, and add an index on `(user_id, updated_at desc)`.
- Confidence: confirmed by reading code.

**[impact low] Static metadata assets are served `max-age=0, must-revalidate` (`.next/server/app/*.meta`).**
- Scenario:
  - This applies to `opengraph-image.png`, `twitter-image.png`, `apple-icon.png` and `favicon.ico`. The og and twitter PNGs are byte-identical duplicates (45,939 bytes each). `app/icon.svg` and `public/icon-*.png` are not checked.
  - Every request is revalidated. That is cheap, but there is no long-lived cache.
- Fix: add a `headers()` entry in `next.config.ts` with `public, max-age=86400, stale-while-revalidate` for those paths, and drop the duplicate twitter image.
- Confidence: confirmed from the build output.

**[impact low] apps/web/lib/layout.ts:30 - ELK (1.45 MB raw, 431 KB gzip) is fetched only after the first Build returns.**
- Scenario: lazy loading is correct (keeps it off `/login` and the blank canvas), but it adds latency exactly when the first diagram is drawn.
- Fix: warm `import("elkjs/lib/elk.bundled.js")` on idle once `ProseInput` mounts.
- Confidence: confirmed by reading code and chunk sizes.

**[impact low] apps/web/lib/usage/server.ts:52 - Payload logging is on by default.**
- Scenario:
  - Every attempt stores the full system prompt, messages and output in `ai_call_payloads`. Retries repeat the whole model, and the same system prompt is stored on every row.
  - Growth is unbounded unless the cron in `db/ai-usage.sql:311-314` is scheduled (docs/DEPLOYMENT.md:16).
- Fix: store only `system_prompt_hash` (already recorded), or keep payloads only for non-ok outcomes, and confirm the cron job is scheduled.
- Confidence: confirmed by reading code. Volume is plausible and not measured.

**[impact low] apps/web/app/api/*/route.ts - No abort on client disconnect.**
- Scenario: `request.signal` is never passed to the engine, so calls continue after the user closes the tab or switches project. Wasted spend is only recorded after the fact (`reportOutcome`).
- Fix: plumb `signal` through `StructuredCallOptions` into `messages.create`.
- Confidence: confirmed by reading code.

**[impact low] packages/engine/src/inference/structuredCall.ts:209-212 - The prompt-cache write premium may not pay back at launch traffic.**
- Scenario:
  - Every call marks `system` and the tool as ephemeral cache breakpoints. Single-shot labels (findings, coverage, extended, workload) rarely repeat within the 5-minute TTL, so they pay the 1.25x write price with few reads.
  - The absolute cost is small, about $0.001-0.003 per call. Haiku calls with short prefixes may fall under the model's minimum cacheable length and not cache at all (from memory, not verified).
- Fix: check `ai_calls.cache_savings_usd` in the admin dashboard after launch. Disable the breakpoints for labels that never read.
- Confidence: plausible.

**Checked and sound**
- **Login bundle:** it does not pull in the workspace, xyflow or elk.
  - Login is about 248 KB gzip across 9 chunks (`.next/server/app/login.html`).
  - `/` is about 323 KB gzip.
  - `elkjs` is loaded via dynamic import.
- **Fonts:** `next/font` self-hosts three fonts, about 75 KB, preloaded.
- **Third-party scripts:** the Google GSI script uses `next/script`. hCaptcha loads only when the guest option with captcha is on (`login/page.tsx:71-86`).
- **Images:** app and public PNGs are all under 46 KB.
- **`/api/trial/status`** should cost no Auth call for visitors without a session (proxy `getUser` with no cookie should not reach the network). This is plausible and I did not confirm it.
- **Project list query:** it selects `id, name, updated_at` only, not the `data` blob. Browser-side project calls use local `getSession()`, not network `getUser()`.
- **Diagram rendering:**
  - Nodes are `memo`'d.
  - Store selectors are narrow, with no bare `useAppStore()` anywhere.
  - Layout depends on `components` and `edges` only, and findings changes skip relayout.
  - The diagram has at most about 22 nodes.
- **Chat cost:** it runs on Haiku with a client history window of 8 and a 1500-character message cap.
- **Findings refresh:** it is not automatic on tier or queue changes (`lib/store/findings.ts`).
- **Quota mechanics:** reserve and release are atomic and replay-safe. `explainFix` and `extractWorkloadParameters` are on Haiku. Usage writes run in `after()` and add no request latency.

**Not checked**
- `/admin/usage` and `lib/usage/dashboard.ts` query cost (admin-only).
- Real Vercel function limits and region (depends on plan).
- Measured token counts and cost per action. There was no live data, and `findings` and `explain-fix` cost is not in the repo docs.
- Runtime DB timings and `EXPLAIN` plans (no DB access used).
- Whether the Supabase project uses asymmetric JWT signing keys, which decides whether `getClaims()` avoids the network.
