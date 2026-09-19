# PLAN-6.md — Earn trust

**Goal:** make finding quality something you can demonstrate, and let real
usage decide what the engine models next.

**Prerequisite:** PLAN-5 shipped, with usage data and at least some
purchases.

This phase is deliberately vague about features and specific about method,
same as its predecessor was — the point is that this phase is driven by
evidence that doesn't exist yet. A detailed feature list written now would
be guessing.

---

## The problem this phase solves

Anyone can ship prose-in, annotated-flow-out on top of an LLM in a weekend,
and it will look close to this app while verifying nothing. The previous
version of this plan's answer to that was a hand-written pattern-matching
engine whose output was provably computed, not generated — a real
differentiator, but one that structurally couldn't keep up with what an
AI-driven model could represent (see `CONTEXT.md`'s "Findings are
AI-generated" for the full account of why it was deleted instead of
extended). That answer is gone. This phase needs a different one, built on
top of the choice that replaced it, not a return to the old one.

## 6.1 — Prove finding quality, not computation

**This replaces the old plan's "calibration against real systems" section
outright** — that method compared the numeric engine's predicted latency
against a real k6/Locust load test; there is no numeric prediction left to
calibrate, on either the deleted numeric engine or the deleted categorical
one. The new question is different: not "is the math right" but "does the
AI reliably name real risks and avoid inventing plausible-sounding ones."

- Build on PLAN-4.2's one-time audit: make finding-quality review a
  recurring practice, not a single pass — a sample of real (or
  realistic) systems, reviewed by someone who can tell a correct finding
  from a fluent-sounding wrong one, on some regular cadence.
- Publish the result, including where the AI was wrong. The old plan's
  instinct — "fix the model, never the number" — has a direct analog
  here: if the AI is systematically wrong about something (a specific
  component kind, a specific risk category), that's a prompt/schema
  problem to fix, not a result to quietly stop measuring.
- Consider whether any partial verification is worth adding back — not a
  full deterministic engine, but something short of pure trust: a second
  AI pass that checks the first one's reasoning, or a narrow computed
  check for the handful of risks that genuinely are just topology shape
  (a single point of failure is a graph fact, not a judgment call).

**Acceptance:** a stated, evidenced quality rate ("X% of findings across N
sampled systems named a real, traceable mechanism"), not a one-time
anecdote — and a public account of where it's wrong, the same standard the
old numeric-calibration section held itself to.

## 6.2 — Expand by demand, not by taxonomy

Carried forward unchanged in spirit from the old plan — this reasoning
never depended on which engine generation was running.

- Log every inference that needed a component kind the engine lacks (the
  12 kinds today may not be the ceiling, but a 13th should trace to a
  real logged gap, not a taxonomy itch).
- Log every session where a user corrected the same trait repeatedly — it
  means inference is systematically wrong there.
- Log finding clicks / fix applications. Findings nobody acts on aren't
  worth deepening.

**Do not** add a component or a finding category because coverage feels
incomplete. A shallow model of something is worse than no model of it — it
produces confident output about something nobody thought through.

**Acceptance:** each addition traces to a logged gap, and ships with the
same "reasoned on paper, not captured from a run" test discipline as
everything else in this codebase.

## 6.3 — Retention, if the data supports it

Also carried forward unchanged — three possible answers, decide with
evidence rather than building all three:

- **Persistence and drift.** Re-run a saved project next quarter, show
  what changed. Works if projects are actually revisited — check PLAN-5's
  usage data first.
- **Content treadmill.** A stream of new example systems. Works for a prep
  audience, but it's a content business, not a modelling moat.
- **CI integration.** Architecture-review checks that run on a real PR.
  Strongest retention mechanism since the trigger isn't user motivation,
  but it's a different product and costs the prep audience.

**Decide with evidence**, same discipline as 6.1.

---

## What would make you stop

- 6.1's recurring audit shows the AI-generated-findings bet isn't holding
  up at the rate 4.2 first measured — degrading, not just imperfect. Worth
  revisiting whether some verification needs to come back, even partially.
- Usage shows the fix loop is rarely reached at all. Whatever differentiates
  this from a wrapper was never being exercised.
- A free competitor ships a comparable loop and the only remaining edge
  (finding quality) isn't something users can perceive or verify themselves.

None of these are failures. A tool that teaches distributed-systems risk
well is worth having built regardless of whether it clears every bar here.
