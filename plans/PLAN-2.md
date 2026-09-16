# PLAN-2.md — Shippable

**Goal:** strangers can use it, costs are controlled and measured, money can
change hands.

**Prerequisite:** PLAN-1's loop produces insight, confirmed on someone who is
not you.

Order matters here. Cost instrumentation comes before the free tier, because a
free tier without measurement is an unbounded liability.

---

## 2.1 — Token instrumentation

First, before any optimisation. You cannot tune what you have not measured, and
every per-session cost estimate so far is a guess.

- Log per call: input tokens, output tokens, cached tokens, model, call type,
  session id.
- Aggregate per session. Surface a simple internal view.

**Acceptance:** you can state actual cost for the last 50 sessions, split by
call type, and see the spread rather than just the mean.

## 2.2 — Cost controls

Apply in this order; the first two are most of the saving.

1. **Prompt caching.** System prompt, component vocabulary, and fix catalogue
   are identical across all users. Order them first in the prompt and keep them
   byte-identical — one character of drift invalidates the cache.
2. **Digest, not graph.** Chat and ranking calls get a compact model summary
   (components, edges, saturation state), never full node JSON. Full model stays
   client-side.
3. **Model tiering.** Inference and patch ranking use the strong model.
   Explanation copy uses a cheap one.
4. **Pre-generated copy.** Finding explanations are keyed by code plus component
   kind — a few dozen strings, written once, cached. Only novel cases call out.
5. **Debounce.** Constraint changes fire on release, not on every tick.
6. **Output caps.** Tight `maxTokens` per call type.

**Acceptance:** measured cost per typical session drops materially against the
2.1 baseline, with the cache hit rate visible. Verify against real numbers — do
not trust the estimate.

## 2.3 — Chat, scoped

Chat is the correction channel. That is its job.

- **Hard rule: chat cannot state a number that did not come from the engine.**
  A question about capacity triggers a simulation run, and the answer reports
  its output. If the indicator and chat can disagree, trust collapses.
- Structured intent: correct a parameter, explain a finding, or ask about the
  model. Corrections update parameters and re-simulate.
- Explanation turns run on the cheap model against the digest.

**Acceptance:** an adversarial test set of capacity questions produces no
number that is absent from `SimulationResult`.

## 2.4 — Persistence

- Postgres (Neon or Supabase). Models, sessions, credit balances.
- Saved models are shareable by link, read-only.

Shareable replay is the one growth mechanism none of the competitors have. A
link showing a system breaking and then stabilising is worth more than any
landing page copy.

**Acceptance:** a model survives reload and opens correctly from a share link.

## 2.5 — Accounts and the free tier

- Email-gated. Anonymous limits are decorative — browser storage resets in
  seconds and cost becomes unbounded.
- **One complete free run** on the user's own system.
- **Examples are free and unlimited** — they are cached, cost nothing, and do
  most of the convincing. The free run should be spent on their system, not on
  finding out what the tool is.
- State the limit before they type. A silent exhaustion reads as broken; a
  stated one reads as a rule.

**Acceptance:** a new user can explore examples indefinitely, run their own
system once, and understands the boundary before hitting it.

## 2.6 — Credits

- Priced by what an action does, **classified deterministically by action type,
  never by asking a model to judge intent.** Paying to bill is absurd, and
  intent classification is gameable.
- Re-simulation and model changes cost credits. Explanation chat does not.
- Price shown on the control before the click. A silently draining balance stops
  people exploring, which is the opposite of what you want.
- Credits never expire. Two or three tiers maximum.

**Acceptance:** a user can predict what an action costs before taking it.

## 2.7 — Payments

- Stripe Checkout. $5 / 5 runs as the main entry, $15 / 20 above it, $1 single
  run offered at the moment the free run is exhausted.
- Webhook credits the balance. Idempotent on event id.

**Acceptance:** a test purchase credits exactly once, including on webhook
replay.

## 2.8 — Ship

- Vercel, environment variables, error monitoring.
- Rate limit per account independent of credits — credits bound cost, not abuse.
- Instrument the funnel: land → describe → first run → indicator click → fix
  applied → exhausted → purchase.

**Acceptance:** you can see where people stop.

---

## What the funnel tells you

If conversion is near zero, the likely cause is that one run was not enough to
establish trust — not that the price was wrong. Resist cutting price first;
look at whether people reached a fix at all.

If most users never pass five chat turns, the caps are theatre and can loosen.
If a few hit every limit every session, you have found either your best
prospects or your abusers, and you need to know which.

## Out of scope

Calibration against real load tests, new component kinds, team features. Phase 3,
and only with evidence from this one.
