# archsim

Capacity simulation engine. Phase 0 of the architecture simulator.

```bash
npm install
npm test          # 78 tests
npm run typecheck
```

## What this is

The headless engine only. No React, no DOM, no LLM, no network. It takes a
system model plus a load and returns where that system breaks, with the numbers
behind the verdict.

It was built before any interface deliberately. A canvas over a weak engine is
the thing this product is trying not to be, and the engine is the part that is
hard to fake.

## Design rules that are load-bearing

**Findings are computed, never generated.** `deriveFindings` in `solver.ts`
decides what is wrong and attaches numeric evidence. The eventual LLM layer may
phrase a finding; it may not place one. If that boundary moves, the product
becomes a diagramming tool with opinions.

**Every parameter carries provenance.** `Parameter` records whether a value was
stated by the user, inferred from prose, or defaulted, plus a one-line rationale.
Prose-derived modelling means the engine is guessing service times, and the
correction loop only works if the UI can show what was guessed and let the user
overwrite it.

**Saturated components return `Infinity`, not a large number.** A finite latency
for a system that cannot keep up is a plausible-looking lie, and plausible lies
are the main risk to this product.

**Severity is graded by time to impact.** A queue that overflows in 20 minutes
is critical; the same queue overflowing in 28 hours is a warning. Every finding
red by default trains users to ignore red.

## What the golden tests are for

`tests/golden.test.ts` encodes what an engineer who has operated these three
systems expects. Expected failure points were written down before the engine was
trusted. Expected values are derived on paper from closed-form results, not
captured from a previous run — a snapshot would happily lock in a wrong model.

If the engine and the hand-model disagree, the engine is wrong until proven
otherwise. That rule caught real bugs on the first run:

- **The herd model was structurally wrong.** It keyed off aggregate extra load,
  in which the hot-set term cancels, so a 10-key and a 10,000-key cache looked
  identical. The damage from a herd is N identical in-flight queries for *one*
  key, which depends on refill time and per-key rate. A cache over an 8ms
  primary-key lookup essentially cannot herd; a cache over a 150ms aggregation
  herds badly at the same traffic.
- **Async boundaries leaked into user-facing latency.** A 2-second transcode
  behind SQS was being reported as caller latency.
- **Replication lag fired at break-even** and reported "0 seconds of lag per
  second" as its own evidence.

The third one is the one worth internalising. It was not a math error — the
finding was technically true. It just read as broken to anyone who knew the
system, which for a trust-dependent product is the same thing as being wrong.

## Modelling assumptions, stated plainly

M/M/c throughout: Poisson arrivals, exponential service times, no priority, no
batching, no coordinated omission, infinite queue capacity unless a component
bounds its own. Real systems violate all of these. Numbers are directional and
the UI has to say so.

Known gaps, listed so they can be added rather than silently assumed away:

- Synchronized cache expiry (deploy or flush populating every key at once) is
  far worse than the steady-state herd model and is not represented.
- The p99 for `c > 1` adds mean service time to the waiting-time quantile,
  which understates the tail. If calibration shows this matters, replace it
  with a proper convolution rather than tuning a fudge factor.
- Retries, circuit breakers, and autoscaling lag are not modelled. Cycles are
  rejected rather than silently unrolled.

## Phase plan

**Phase 0 — prove the core.** This package. Engine, three hand-modelled
reference systems, golden tests, Zod inference schema, prose-to-model function,
and a CLI harness are built. Remaining: the actual comparison — run inference
against the hand-models with a live API key and check the inferred parameters,
then run it against a system you've personally operated. That is the kill
criterion — if inference is wrong in ways that change the conclusion, stop.
See `plans/PLAN-0.md` for exact status.

**Phase 1 — the loop.** Derived constraint controls with every value visible and
editable, React Flow rendering with stable node identity, ELK layout with pinning
and animated transitions, computed indicators, and click → choices → patch →
re-simulate → show the delta. `findBreakingPoint` already backs the sliders: the
question users ask is not "is 50k fine" but "where does this fall over".

**Phase 2 — shippable.** Chat scoped to correction and explanation, hard-wired
so numbers come from engine output. Prompt caching, model tiering, digest-not-
graph, debounced runs. Email gate, one free run, credits, Stripe.

**Phase 3 — with evidence only.** Expand components based on what users ask for.
Calibrate against real pgbench and k6 runs; that is what turns the engine from a
claim into the differentiator.

## Structure

```
src/queueing.ts            Erlang B/C, M/M/c, response quantiles, Little's Law
src/components.ts          Per-component capacity models
src/solver.ts              Load propagation, critical path, findings, breaking point
src/inference/schema.ts    Zod schema an LLM fills; mirrors SystemModel exactly
src/inference/prompt.ts    The system prompt, kept separate so it can be diffed
src/inference/fromProse.ts Prose -> SystemModel: one call, validate, one repair retry
src/whatif.ts              Scenario catalog + apply/compare: relative "what if" perturbations
src/fixes.ts               Fix catalog keyed by finding code + apply-fix-then-resimulate
models/reference.ts        Three hand-modelled systems (the oracle)
bin/sim.ts                 CLI: prose or --model <id>, prints model + findings
bin/whatif.ts              CLI: indicator -> failures -> fixes with tradeoffs -> resimulate
tests/                     Golden tests, queueing math tests, schema tests
docs/inference-log.md      PLAN-0.4's comparison runs
```

## What-if, not point forecasts

PLAN-0.4 found that inferring *absolute* duration and capacity numbers from
prose is unreliable — bottleneck identity correct in only 30% of 10 runs (see
`docs/inference-log.md`). That failure is specific to getting one number
right (is this query 15ms or 40ms?); it says nothing about whether the
engine's queueing math is sound, which the golden tests hold to a real
hand-derived standard.

`src/whatif.ts` and `src/fixes.ts` are built on that distinction — and are
the actual product scope, not a fallback. Instead of asking the engine to
forecast an absolute number from an uncertain baseline, the flow asks
relative questions of whatever model you already have: every node with a
possible failure is an indicator; clicking it lists the failures that node
could plausibly suffer (`whatif.ts`); picking one shows the impact and lists
fixes with their tradeoffs for whatever it actually broke (`fixes.ts`,
looked up by the finding produced, not hardcoded per failure); picking a fix
re-simulates and reports whether *that specific finding* cleared — not a
blanket "everything's fine," since a fix can resolve what it targets while
an unrelated finding persists.

```bash
npm run whatif -- --model checkout                                                    # indicators
npm run whatif -- --model checkout --scenario workload:traffic-5x                     # failures + fixes
npm run whatif -- --model checkout --scenario workload:traffic-5x --fix db:pool-2x    # resimulate
```

A relative comparison only needs the mechanism to be correct, not the
baseline's exact values — which is exactly the thing PLAN-0.4 showed the
engine already does well and inference does not.

The engine takes a model and returns results. It imports nothing from the app.
If TypeScript ever stops being fast enough, the implementation swaps and nothing
above it changes — but at tens of components and one run per interaction, that
is not the bottleneck and Rust would be solving a problem this does not have.
