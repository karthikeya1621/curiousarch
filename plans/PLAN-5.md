# PLAN-5.md — Shippable

**Goal:** strangers can use it, cost is controlled and measured, money can
change hands.

**Prerequisite:** PLAN-4's loop produces insight, confirmed on people who
are not the builder — and 4.2's finding-quality audit doesn't turn up a
systematic problem.

Some of what a "shippable" phase usually needs is already done, ahead of
that prerequisite ever being formally checked: auth (magic-link + Google),
Postgres-backed persistence, and multi-project support are all live. This
phase is what's left.

Order matters here, same as before: cost instrumentation comes before the
free tier, because a free tier without measurement is an unbounded
liability.

---

## 5.1 — Token/cost instrumentation

Not yet built — `structuredCall.ts` never reads `response.usage` at all
today. You cannot tune what you have not measured, and every per-session
cost estimate so far (including the guardrail cost/benefit numbers from
this session) is a reasoned guess, not a measurement.

- Log per call: input tokens, output tokens, cache-read/cache-creation
  tokens, model, call type (`fromProse`/`reworkModel`/`identifyFailures`/
  chat/etc. — `structuredCall.ts`'s existing `label` parameter is the
  natural key), session/project id.
- Aggregate per project. Surface a simple internal view.

**Acceptance:** you can state actual cost for the last 50 sessions, split
by call type, and see the spread rather than just the mean.

## 5.2 — Cost controls

Some of this is already done; verify it's actually paying off before
adding more.

1. **Prompt caching — already implemented.** Every `structuredCall.ts`
   call marks its system prompt and tool schema as `cache_control:
   ephemeral` breakpoints. 5.1's instrumentation is what would tell you the
   actual hit rate; right now nobody's measured it.
2. **Guardrails — already implemented**, from earlier this project's
   history: `MAX_BASE_COMPONENTS`/`MAX_EXTENDED_COMPONENTS`/
   `MAX_TOTAL_COMPONENTS`, a description-length cap on Build, a pre-flight
   warning near the cap on Re-simulate.
3. **Digest, not full model, for chat and findings — not done.**
   `chatWithProject.ts` and `identifyFailures.ts` both send the complete
   model JSON every call. `MAX_TOTAL_COMPONENTS` (21) keeps this bounded,
   so this may not be worth doing — check with 5.1's real numbers before
   spending effort here.
4. **Model tiering — partially done.** `structuredCall.ts` already
   distinguishes `AI_REASONING_MODEL`/`AI_UTILITY_MODEL` by call purpose
   (see its own top comment); confirm every call is actually on the
   cheapest tier that still produces acceptable quality, informed by 5.1.
5. **Debounce — already done** for auto-save (`AutoSaveIndicator.tsx`,
   1500ms); the workload-tier slider's Re-simulate is already
   user-triggered, not fired on every drag tick.
6. ~~Pre-generated copy keyed by finding code~~ — **no longer applicable.**
   This assumed the deleted `FindingCode` closed enum; `AiFinding`'s
   `code`/`explanation` are free-form AI text now, with no small fixed set
   of strings to pre-generate.

**Acceptance:** measured cost per typical session, from 5.1's real
numbers, not an estimate — and a decision, with evidence, on whether 5.2.3
is worth building at all.

## 5.3 — Chat, scoped

Partially superseded by a deliberate product decision already made: chat
now explicitly answers questions as well as making corrections (see
`CONTEXT.md`'s "Decisions already made" table) — "chat is the correction
channel, that is its job" is no longer the rule. What should still hold:

- A question's answer should be grounded in the actual current model, not
  invented — `chatWithProject.ts` already passes the full model as
  context for exactly this reason.
- Explanation-only turns (a question, not a change) are a candidate for
  the cheap model tier if 5.1's numbers show they're a meaningful cost
  share — done: chat is now a single small structured call on the cheap
  model tier for questions and change requests alike (a change is queued,
  and `reworkModel.ts` implements it at Re-simulate).

**Acceptance:** an adversarial test set of architecture questions produces
no answer that isn't traceable to something actually in the model it was
given.

## 5.4 — Accounts and the free tier

Auth exists; usage limits do not.

- Anonymous access isn't offered today (the app is fully gated by
  `middleware.ts`) — decide whether that stays, or whether an anonymous
  "try an example" path is worth the abuse-surface it opens.
- **One complete free run** on the user's own system, then a stated limit
  — not a silent exhaustion.
- Reference examples (the three models in `models/reference.ts`, if
  surfaced in the UI) should be free and unlimited if they end up being
  the thing that does the convincing.

**Acceptance:** a new user can understand the boundary before hitting it.

## 5.5 — Credits

Decided (see `CONTEXT.md`: "Credits, not subscription") but genuinely
unbuilt — no billing or usage-metering code exists anywhere in `apps/web`
today.

- Priced by action type, classified deterministically (which call ran —
  Build, Re-simulate, chat correction — never by asking a model to judge
  intent).
- Explanation-only chat should probably stay free, consistent with 5.3.
- Price shown before the click. Credits don't expire. Two or three tiers.

**Acceptance:** a user can predict what an action costs before taking it.

## 5.6 — Payments

- Stripe Checkout, a small number of tiers, exact pricing informed by
  5.1's real cost data rather than guessed.
- Webhook credits the balance. Idempotent on event id.

**Acceptance:** a test purchase credits exactly once, including on webhook
replay.

## 5.7 — Ship

- Deployment (Vercel or equivalent), environment variables, error
  monitoring.
- Rate limit per account independent of credits — credits bound cost, not
  abuse.
- Instrument the funnel: land → describe → first run → finding click →
  fix applied → exhausted → purchase.
- Stand up CI running `npm test`/`npm run typecheck` (and 4.3's UI flow,
  once it exists) on every PR — none of this runs anywhere but locally
  today.

**Acceptance:** you can see where people stop, and a broken build can't
merge silently.

---

## Out of scope

New component kinds beyond the current 12 (only add one from a logged
real-usage gap, not speculatively), team features, anything from PLAN-6.
