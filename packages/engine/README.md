# archsim

Architecture-pattern engine. No React, no DOM, no LLM at rest, no network.

```bash
npm install
npm test          # 70 tests
npm run typecheck
```

## What this is

The headless engine only. It takes a rough system model — components tagged
with a handful of categorical traits, never a number — and returns which
real architectural risks it has, with the reasoning behind each one.

It was built before any interface deliberately. A canvas over an LLM that
just narrates opinions is the thing this product is trying not to be, and
the pattern catalogue is the part that is hard to fake.

## Design rules that are load-bearing

**Findings are computed, never generated.** `evaluatePatterns` in
`patterns.ts` decides what is wrong and attaches evidence naming the exact
traits that combined to produce it. The LLM layer may phrase a finding; it
may not place one. If that boundary moves, the product becomes a
diagramming tool with opinions.

**An AI may choose values, never transforms.** `fixes.ts`'s
`UNCACHED_DATABASE_AT_SCALE` factory is the one fix with genuine free
parameters — a freshly-inserted cache's `ttl`/`keyspaceSize`/
`hasStampedeProtection` — and `inference/proposeCacheTraits.ts` lets an AI
choose them for the specific system instead of a hardcoded default. The
*shape* of the transform (insert a cache, rewire these edges) is still
entirely hand-written; the AI never decides whether to add a cache, what
kind of component to add, or whether a combination is safe — findings are
still recomputed on the result exactly as always, so a bad AI choice shows
up as a real, computed finding, not a claim anyone asserted. The other 6
fixes are plain binary trait flips with nothing to decide, so they stay
fully deterministic with no network call at all.

**Every trait carries provenance.** `Trait<T>` records whether a value was
stated by the user, inferred from prose, or defaulted, plus a one-line
rationale. Prose-derived modelling means the engine is guessing categories
(does this have a replica? is the TTL short?), and the correction loop only
works if the UI can show what was guessed and let the user overwrite it.

**A pattern earns its place by being real, well-known architectural
wisdom — not by padding the catalogue for coverage.** Seven patterns exist
today (below); an eighth should be added because you have a specific,
checkable failure mode in mind, never to hit a round number. A pattern that
sounds plausible but doesn't correspond to something a real incident report
would name is exactly the failure mode this whole approach exists to avoid.

**Severity reflects real consequence, not a number crossing a threshold.**
`SINGLE_POINT_OF_FAILURE`, `THUNDERING_HERD_RISK`, and
`CASCADING_FAILURE_RISK` are critical because they describe something that
actually breaks when it happens. `UNBOUNDED_ADMISSION`, `QUEUE_NO_DEAD_LETTER`,
and `FIXED_SCALING_AT_SCALE` are warnings — real risk, not yet a proven
failure. All-critical trains users to ignore critical.

## Why there are no numbers here

An earlier version of this engine simulated M/M/c queueing math over
inferred magnitudes (`queryTimeMs: 25`, `connectionPoolSize: 240`). It
worked, and its math was correct — golden-tested against hand-derived
formulas — but the numbers feeding that math were guesses an LLM had no way
to actually verify from a prose description, and precise math on top of a
guessed number produces a confident, specific-sounding **wrong** answer.
That's worse than an honest rough one. The full account, including a live
demonstration of exactly this failure mode (a different LLM asked to
explain a screenshot of the old engine's output, which produced a fluent
and completely fabricated causal story), is in the repo root's
`CONTEXT.md` under "Why the pivot." The short version: "does this have a
read replica" is a question a sentence can actually answer; "what's the
query time in milliseconds" never was.

## The pattern catalogue

| Code | Severity | Fires when |
|---|---|---|
| `SINGLE_POINT_OF_FAILURE` | critical | A load-bearing service/database has `instanceCount: "single"` |
| `THUNDERING_HERD_RISK` | critical | A cache has `ttl: "short"` + `keyspaceSize: "small"` + `hasStampedeProtection: false` |
| `CASCADING_FAILURE_RISK` | critical | A synchronous chain (stops at a queue) is 3+ deep with no circuit breaker anywhere in it |
| `UNBOUNDED_ADMISSION` | warning | A gateway has `hasRateLimiting: false` |
| `QUEUE_NO_DEAD_LETTER` | warning | A queue has `hasDeadLetterQueue: false` |
| `FIXED_SCALING_AT_SCALE` | warning | A queue has `consumerScaling: "fixed"` at `"large"`/`"massive"` workload scale |
| `UNCACHED_DATABASE_AT_SCALE` | warning | A read-heavy (`writeVolume: "low"`) database sits directly on a synchronous chain with no cache anywhere in it, at `"large"`/`"massive"` scale |

## What the golden tests are for

`tests/golden.test.ts` encodes what an engineer reviewing these three
systems would expect: which real risk each one has going in, and why.
Expected outcomes are reasoned on paper from the traits themselves — which
pattern fires, on which component, for which reason — never captured from a
run. If the engine and the hand-reasoning disagree, the engine is wrong
until proven otherwise.

## Modelling assumptions, stated plainly

Every component kind carries 1-3 rough traits, deliberately not more — see
`types.ts`. This is a scope decision: the pattern catalogue only needs
enough signal to name a real risk, not a full configuration surface. If a
new pattern needs a trait no component has yet, add the trait to the
specific kind(s) it applies to, update `inference/schema.ts` and
`prompt.ts` together, and write the pattern's tests both directions (fires
when it should, doesn't when it shouldn't) before considering it done.

Known gaps, listed so they can be added rather than silently assumed away:

- The catalogue is seven patterns, not an exhaustive list. Real wisdom not
  yet encoded: idempotency/retry safety, multi-region risk, credential
  handling, observability gaps.
- `UNCACHED_DATABASE_AT_SCALE` is the only pattern whose fix is structural
  (it inserts a new cache component rather than flipping a trait) — see
  `withInsertedComponent` in `whatif.ts`. This closes what was previously a
  real gap: no fix could ever add a component to the topology.
- `CASCADING_FAILURE_RISK` only checks whether *a* circuit breaker exists
  anywhere in the chain, not whether it's configured sensibly (a breaker
  with a threshold of 10,000 failures isn't meaningfully protective).
- Provenance mislabeling (an LLM tagging a guess as `"stated"`) was observed
  once, pre-pivot, on the numeric schema. `prompt.ts` has an explicit
  self-check against this; not yet reconfirmed at volume on the categorical
  schema specifically.

## Structure

```
src/types.ts               Trait<T>, Component/SystemModel/ScaleTier, isTrait
src/patterns.ts            The seven architectural patterns — this is the engine now
src/components.ts          isAsyncBoundary (a queue is where a sync chain stops)
src/solver.ts              simulate() (cycle check + run every pattern), findBreakingTier()
src/inference/schema.ts    Zod schema an LLM fills; every trait is a boolean or small enum
src/inference/prompt.ts    The system prompt, kept separate so it can be diffed
src/inference/fromProse.ts Prose -> SystemModel: one call, validate, one repair retry
src/inference/proposeCacheTraits.ts  The one AI call in the fix flow: values only, see above
src/whatif.ts              Scenario catalog + apply/compare: flip a trait toward its riskier value
src/fixes.ts               Fix catalog keyed by finding code + apply-fix-then-resimulate
models/reference.ts        Three hand-modelled systems (the oracle)
bin/sim.ts                 CLI: prose or --model <id> [--scale <tier>], prints model + findings
bin/whatif.ts              CLI: indicator -> failures -> fixes with tradeoffs -> resimulate
tests/                     Golden tests, schema tests, tool-schema tests
docs/inference-log.md      Historical: the numeric engine's PLAN-0.4 comparison runs
```

## What-if, not point forecasts

A scenario is a hypothetical degradation — a replica failing, a rate
limiter getting disabled, traffic growing a tier — never a numeric stress
multiplier. Every node with a possible failure is an indicator; clicking it
lists the failures that node could plausibly suffer (`whatif.ts`); picking
one shows the impact and lists fixes with their tradeoffs for whatever it
actually broke (`fixes.ts`, looked up by the finding produced, not
hardcoded per scenario); picking a fix re-simulates and reports whether
*that specific finding* cleared — not a blanket "everything's fine," since
a fix can resolve what it targets while an unrelated finding persists.

```bash
npm run whatif -- --model checkout                                              # indicators
npm run whatif -- --model checkout --scenario svc:loses-instance                # failure + fixes
npm run whatif -- --model checkout --scenario svc:loses-instance --fix svc:add-instance  # resimulate
```

The engine takes a model and returns results. It imports nothing from the
app. If TypeScript ever stops being fast enough, the implementation swaps
and nothing above it changes — but at a handful of components and one
pattern pass per interaction, that is not the bottleneck.
