# Performance & cost specialist report - run 2 (Oct 1 2026)

Read-only review of commit 104e12d. Status after same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced verbatim from the specialist's final message.

**[impact medium] apps/web/app/login/page.tsx:18 - new regression, see "changed since run 1" below.**
*(Status: fixed same day - see the detailed writeup below; `guestTrialOpen()` now has its own in-process 30s cache.)*

**[impact medium] apps/web/proxy.ts:41, apps/web/lib/trial/server.ts:32, apps/web/lib/usage/server.ts:30 - still 3 sequential `auth.getUser()` round trips per AI request.**
Scenario: `app/api/infer/route.ts` calls `reserveTrial()` (one `getUser()`) then `startUsage()` (another `getUser()`); proxy already did a third for the page/route gate. No code anywhere calls `getClaims()` (`git grep getClaims apps/web` -> zero hits) and neither helper reuses the other's resolved user.
Fix: unchanged from run 1 - switch to `getClaims()` or have `startUsage` accept the user `reserveTrial` already resolved.
Confidence: confirmed by reading code.

**[impact medium] apps/web/components/AdminUsageLink.tsx:20, apps/web/app/api/trial/me/route.ts, apps/web/app/api/admin/status/route.ts - still two separate client fetches / server auth checks instead of one.**
Scenario: `/api/trial/me` returns `{limited, guest}` only; `admin` was never added to it. `AdminUsageLink` still calls `/api/admin/status` on every mount, each doing its own `getUser()`.
Fix: unchanged from run 1 - add `admin` to `/api/trial/me`, delete the second endpoint/fetch.
Confidence: confirmed by reading code.

**[impact medium] apps/web/db/ai-usage.sql:51-54 (also setup-production.sql:116-119) - still no index that fits `trial_spend_today`.**
Scenario: `trial_spend_today()` (db/guest-trial.sql:44-49) filters `ai_calls` by `created_at >= today` across all guests, then joins to `trial_accounts`. Only composite indexes exist: `(user_id, created_at desc)` and `(project_id, created_at desc)` - neither matches a date-range scan that isn't first filtered by one user/project. No standalone `ai_calls(created_at)` index was added.
Fix: unchanged from run 1 - `create index on ai_calls (created_at)`.
Confidence: confirmed by reading SQL.

**[impact medium] packages/engine/src/inference/{structuredCall,fromProse,reworkModel}.ts - still no per-action model-call cap.**
Scenario: `git grep -n "maxCalls|callCount|callBudget"` across all three files returns nothing. Worst-case fan-out (Build up to 20 calls, Re-simulate up to 12) from run 1 is unchanged and still unbounded by any shared counter.
Fix: unchanged from run 1 - shared counter in `StructuredCallOptions` refusing calls past N per action.
Confidence: confirmed by reading code.

**[impact medium] apps/web/lib/usage/pricing.ts:70-71 + apps/web/db/guest-trial.sql:46-49 - still fails open, not closed, on an unpriced model.**
Scenario: `computeCost` returns `costUsd: null` when a model has no entry in `DEFAULT_PRICES`/`AI_MODEL_PRICES`. `trial_spend_today` does `coalesce(sum(c.cost_usd), 0)`, so any call on an unpriced model contributes $0 to both the guest and member daily budgets - it can never trip the cap that's the only backstop while `TRIAL_ENABLED` governs spend.
Fix: unchanged from run 1 - refuse (or hard-cap) a call whose model has no price entry rather than recording it as free.
Confidence: confirmed by reading code.

**[impact low] apps/web/db/projects.sql:18, setup-production.sql:25 - still only `projects (user_id)`, no composite `(user_id, updated_at desc)`.**
Confidence: confirmed by reading SQL.

**[impact low] apps/web/lib/store/slices/versionsSlice.ts:6-10, chat message storage - still uncapped.**
Scenario: the comment on `versions` explicitly says "only ever grows"; nothing trims old versions or caps persisted `chatMessages`. `MAX_CHAT_MESSAGE_LENGTH`/`MAX_PENDING_CHANGES` in `lib/limits.ts` are per-request API validation caps, not storage caps - they don't bound what accumulates in a saved project over time.
Confidence: confirmed by reading code.

**[impact low] apps/web/lib/layout.ts:29-30 - ELK still not warmed.**
Scenario: `elkInstance ??= import("elkjs/lib/elk.bundled.js")...` only runs inside `getElk()`, first invoked from inside `layout()` after a Build returns. `git grep` found no other call site (no idle-time prefetch in `ProseInput.tsx` or elsewhere).
Confidence: confirmed by reading code.

**Checked and sound:** `LoginForm.tsx`'s new `ResizeObserver` (lines 192-201) is cleaned up correctly - `observer.disconnect()` runs in the effect's cleanup, the ref'd div is unconditionally rendered (not remounted), so there's exactly one observer for the component's life and no leak.

**Not checked:** bundle/route sizes - no production `.next` build exists this run (only a dev build dir), and the brief says not to rebuild, so chunk-size claims from run 1 (login ~248 KB gzip, etc.) are unverified this round, not re-confirmed or contradicted.

---

**Changed since run 1**

1. **`/api/trial/status` caching (done, confirmed):** `apps/web/app/api/trial/status/route.ts` now sets `cache-control: public, s-maxage=30, stale-while-revalidate=60` (lines 12-14). That part of C2's "one `/api/trial/me` fetch" family of fixes landed.

2. **`guestTrialOpen()` in `app/login/page.tsx` - this is a real regression, not a non-issue.** Evidence:
   - `page.tsx:8` sets `export const dynamic = "force-dynamic"`, and `page.tsx:18` calls `guestTrialOpen()` directly as a function - a plain `await` inside the Server Component, not an HTTP fetch. `force-dynamic` disables Next's Full Route Cache for this page, so every request runs the Server Component fresh and re-invokes `guestTrialOpen()`.
   - `guestTrialOpen()` itself (`apps/web/lib/trial/server.ts:116-127`) has no memoization of its own - it calls `admin.rpc("trial_budget_open", ...)` on every invocation, which runs `trial_spend_today()`, the same join-and-sum the run-1 caching fix existed specifically to shield.
   - Critically, the comment at `page.tsx:5-7` claims "Same total load on Supabase as before... this replaces the client-side fetch" - but it does **not** replace it. `LoginForm.tsx:84-94` still runs `fetch("/api/trial/status")` in a `useEffect` on every mount, explicitly described in its own comment (line 55-56) as "The client still re-checks once... in case the budget changed."
   - Net effect: every `/login` view now costs **two** DB-reaching paths instead of one - a new, fully uncached server-side RPC call (added) plus the old client-side fetch (kept, still CDN-cached at 30s). This is additive, not a replacement, and it reintroduces exactly the "uncached hit on every visit" pattern the run-1 fix removed, on the single highest-traffic unauthenticated page in a guest-trial product.
   - Fix: either (a) wrap `guestTrialOpen()`'s result in a short in-process memo (e.g. a module-level cache with a 15-30s TTL, read before calling `admin.rpc`) so repeated server renders within the window don't re-hit the DB, or (b) drop the server-side call and keep only the client fetch against the already-cached endpoint, accepting the one-beat pop-in the Server Component was built to avoid. Also remove the now-redundant client re-fetch in `LoginForm.tsx:84-94` if the server-side value is kept authoritative, or justify its 30s staleness as intentional.
   - Confidence: confirmed by reading `page.tsx`, `LoginForm.tsx`, and `lib/trial/server.ts`; not measured in production traffic.
   - *(Status: fixed same day - `guestTrialOpen()` gained a 30s in-process memo (option (a)); the client recheck in `LoginForm.tsx` was kept deliberately, for the different purpose of catching a budget change between the server render and hydration - the misleading "replaces the client fetch" comment was corrected to say so explicitly. A test-only reset hook (`__resetGuestOpenCacheForTests`) was added since the cache is module-level state that otherwise outlives one test case; a new test confirms the cache is hit and that resetting it reflects a changed value, mutation-checked.)*
