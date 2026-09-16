# PLAN-3.md — Earn the moat

**Goal:** make accuracy something you can prove, and let real usage decide what
the engine models next.

**Prerequisite:** Phase 2 shipped, with usage data and at least some purchases.

This phase is deliberately vague about features and specific about method. The
whole point is that Phase 3 is driven by evidence you do not have yet — a
detailed feature list written now would be guessing.

---

## The problem this phase solves

Anyone can ship prose-in, annotated-flow-out on top of an LLM in a weekend, and
it will look close to yours while computing nothing. Your advantage is that the
indicators come from a real engine. That advantage is invisible in a screenshot.

This phase makes it visible.

---

## 3.1 — Calibration against real systems

The strongest thing you can do, and nobody else in this space has done it.

Pick three canonical patterns from the engine — connection pool exhaustion,
queue backlog, cache miss load. For each:

- Stand up the real thing. Postgres with a bounded pool, a queue with a known
  consumer count, Redis in front of a slow query.
- Drive it with k6 or Locust until it breaks. Record where, and the latency
  curve on the way.
- Run the same configuration through the engine.
- Publish the comparison — including where the model was wrong.

**Acceptance:** a public page showing engine prediction against measured
behaviour for three patterns, with the error stated plainly.

**Fix the model, never the number.** If the engine is 40% optimistic on pool
exhaustion, find the missing mechanism. A tuning constant that makes one chart
line up is how a simulator becomes untrustworthy everywhere else.

Two known gaps this will probably surface first:

- The `c > 1` p99 approximation adds mean service time to the waiting quantile,
  which understates the tail. If measurement confirms it matters, replace it
  with a convolution.
- Synchronized cache expiry after a deploy is far worse than the steady-state
  herd model. Real herds will show this immediately.

**Value:** "our pool model matches a real pgbench run within 15%" is a claim no
wrapper can make. It is the only durable answer to "why you and not the free
one".

## 3.2 — Expand by demand, not by taxonomy

Add component kinds and failure modes **only where usage shows a gap.**

- Log every inference that fails validation because the described system needed
  a component the engine lacks. That log is the roadmap.
- Log every session where the user corrected the same parameter repeatedly — it
  means inference is systematically wrong there.
- Log indicator clicks. Findings nobody clicks are not worth deepening.

Likely candidates, in rough order: object storage, search index, external API
dependency with its own SLA, retries and circuit breakers, autoscaling lag.

**Do not** add a component because a taxonomy feels incomplete. Every kind
carries a modelling burden, and a shallow model is worse than an absent one —
it produces confident numbers about something you did not think through.

**Acceptance:** each addition traces to a logged gap, and ships with
paper-derived tests like everything else.

## 3.3 — Retention, if the data supports it

The known weakness is that value concentrates in the first run. Three possible
answers, and the data should pick one rather than you building all three:

- **Persistence and drift.** Re-run a saved model next quarter and show what
  changed. Works if users save models at all — check the Phase 2 data first.
- **Content treadmill.** A stream of new scenarios. Works for the prep segment,
  but that is a content business competing with established players, not a
  simulation moat.
- **CI integration.** Capacity assertions that run on every PR. The strongest
  retention mechanism, because the trigger is not the user's motivation. But it
  is a different product and costs you the prep audience.

**Decide with evidence.** If saved models are rarely revisited, drift is dead.
If prep users dominate, the treadmill is the honest answer. If anyone asks for
an API, CI is real demand rather than a hypothesis.

## 3.4 — Reality Ingestion, reconsidered

The concept document proposed importing Terraform and CloudFormation to
stress-test real environments. Deferred to here, and it should probably stay
deferred.

IaC describes resources, not traffic, service times, query plans, or call
graphs. You can reverse-engineer topology from it, not a performance model. The
information you need lives in telemetry, which means competing with observability
vendors on their ground.

**If revisiting:** the credible version imports *traces*, not IaC. A service map
with measured latencies gives you real parameters — which would eliminate the
inference risk that Phase 0 was built to test. That is a genuinely strong
product and a much larger undertaking.

**Acceptance for reopening:** paying users asking for it specifically, with a
data source they already have.

---

## What would make you stop

Worth naming, because sunk cost is strongest at this stage:

- Calibration shows the models are wrong in ways that need mechanism you cannot
  practically add. The tool is then a teaching aid, not a validation tool — a
  fine outcome, but price and position it as one.
- Usage shows the fix loop is rarely reached. The moat was never exercised.
- A free competitor ships a comparable loop and your only edge is accuracy that
  users cannot perceive.

None of these are failures. A tool that teaches distributed systems well is
worth having built, and the engine is reusable regardless.
