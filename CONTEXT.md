# CONTEXT.md

Context for AI-assisted development. Read before proposing changes.

## What this is

A capacity simulator for distributed systems. The user describes a system in
prose; we infer a model, derive scale constraints as controls, render a flow,
and mark failure points. Clicking a marker offers fixes; choosing one patches
the model and re-simulates to show the delta.

**The interaction is what-if, not forecast.** PLAN-0.4 tested whether
prose-derived inference produces correct *absolute* numbers (this bottleneck,
this exact breaking point) and it doesn't — 30% bottleneck accuracy across 10
runs, every miss a guessed duration/capacity number off by 5-8x. That rules
out forecasting as the product, not the engine: the failure never touched
topology or stated facts, only numbers nobody stated. The product asks a
relative question instead — "what happens to *this* model if traffic
triples, a cache goes cold, a fleet halves" (`packages/engine/src/whatif.ts`) — which only
needs the queueing math to be sound, not the baseline's absolute numbers to
be exactly right. See `plans/PLAN-0.md`'s "Reframing: what-if over
forecasting" for the full reasoning.

**There is no drag-and-drop canvas.** The user never places nodes. Authoring is
prose plus corrections. This is a deliberate product decision, not a missing
feature — do not propose a node palette or a blank canvas.

## The one thing that makes this defensible

Indicators are **computed by the engine**. The LLM may phrase a finding; it may
not decide where one goes or what the numbers are. Competitors have a canvas
plus an LLM that narrates; they compute nothing. If that boundary erodes, this
becomes a diagramming tool with opinions and there is no reason to build it.

Concretely: anything numeric in the UI traces to `SimulationResult`. Chat cannot
answer a capacity question without an engine run behind it.

## Non-negotiable invariants

1. **Findings are computed, never generated.** `deriveFindings` in `solver.ts`.
2. **Every parameter carries provenance** (`stated` / `inferred` / `default`)
   plus a one-line rationale, and the UI shows both. Prose-derived modelling
   means we are guessing service times; the correction loop is what makes that
   survivable.
3. **Saturated components return `Infinity`, not a big number.** A plausible
   latency for a system that cannot keep up is the main risk to this product.
4. **Severity grades by time to impact.** A queue overflowing in 20 minutes is
   critical; the same queue at 28 hours is a warning. All-red trains users to
   ignore red.
5. **Expected test values are derived on paper**, never captured from a run. A
   snapshot locks in a wrong model.

## Decisions already made — do not reopen without new information

| Decision | Reason |
|---|---|
| What-if, not absolute forecasting | PLAN-0.4: 10 comparison runs, 30% bottleneck accuracy, every miss a guessed duration/capacity number off by 5-8x, never a topology or stated-fact error. Relative "what happens if X changes" only needs the queueing math sound, not the baseline's absolute numbers right — and the golden tests hold that mechanism to a real standard. Don't propose re-chasing absolute-number accuracy without new evidence the guessing problem is actually solved. |
| TypeScript engine, not Rust/Wasm | Tens of components, one run per interaction. Runs in ms. Rust solves a problem this does not have. Engine is isolated so it can be swapped if profiling ever says otherwise. |
| No drag-and-drop | The crowded lane. SysSimulator and ~8 others already do canvas + simulation, free. |
| React Flow for rendering | Still needed for nodes/edges/click targets. Layout is programmatic. |
| ELK.js with pinned node identity | Must animate, not repaint. Regeneration is frequent here, so instability is worse than in a drag tool. |
| Chat is for correction, not Q&A | Its job is fixing inferred parameters. Numbers come from the engine. |
| Credits, not subscription | Usage is bursty and low-frequency; subscription fights the pattern. |

## Current state

Phase 0 complete (see `plans/PLAN-0.md`); Phase 1 underway. 78 tests passing,
typecheck clean. The repo is now an npm workspaces monorepo:
`packages/engine/` (everything that was previously at the repo root — `src/`,
`models/`, `tests/`, `bin/`, `docs/`, unchanged internally, just nested) and
`apps/web/` (Next.js App Router UI). `plans/` and this file stay at the repo
root — project-wide, not engine-specific.

- `packages/engine/src/index.ts` — the engine's public entrypoint; import
  from here, not individual files (excludes `src/inference/*`, which stays
  server-side — see PLAN-1.2)
- `packages/engine/src/queueing.ts` — Erlang B/C, M/M/c, response quantiles, Little's Law
- `packages/engine/src/components.ts` — per-component capacity models
- `packages/engine/src/solver.ts` — propagation, critical path, findings, `findBreakingPoint`
- `packages/engine/models/reference.ts` — three hand-modelled systems, used as the oracle
- `packages/engine/src/inference/schema.ts` — Zod schema an LLM fills, mirrors `SystemModel`
- `packages/engine/src/inference/fromProse.ts` — prose in, `SystemModel` out; tool-use +
  validation + one repair retry
- `packages/engine/src/whatif.ts` — scenario catalogue + apply/compare; failure listing per node
- `packages/engine/src/fixes.ts` — fix catalogue keyed by finding code + apply-fix-then-resimulate
- `packages/engine/bin/sim.ts` — CLI harness, prose or `--model <id>`
- `packages/engine/bin/whatif.ts` — CLI: indicator -> failures -> fixes with tradeoffs -> resimulate

`findBreakingPoint` backs the constraint sliders. The user's question is "where
does this fall over", not "is 50k fine".

## Next task

PLAN-0.1–0.4 are done; 0.4's 10-run comparison ruled out absolute forecasting
(30% bottleneck accuracy) without implicating the engine — every miss was a
guessed duration, never a topology or stated-fact error.
`packages/engine/src/whatif.ts` is the response: relative scenario
comparisons instead of absolute forecasts.

0.5 (run the flow against a system you've personally operated, to check
whether the what-if deltas ring true) was explored with invented example
systems rather than a real operated one — useful for exercising the
mechanism (see `packages/engine/docs/inference-log.md` runs 8/10, and the ride-hailing
example in-session), but it doesn't carry the evidentiary weight true 0.5
would. The user chose to proceed to Phase 1 without completing it in the
strict sense. **This is a known, accepted gap, not an oversight** — if a
future session has the chance to run the flow against a real system with a
real operator judging the result, that's still the strongest test available
and worth doing opportunistically.

Current work is Phase 1 (`plans/PLAN-1.md`): converting to npm workspaces
(`packages/engine/` + `apps/web/`) and building the UI. PLAN-1.6/1.7 (the
fix-catalogue-with-tradeoffs flow) are already built as engine capability —
see `packages/engine/src/whatif.ts` and `packages/engine/src/fixes.ts` — the
remaining Phase 1 work is UI (derived controls, the flow diagram, indicators)
around that already-tested foundation.

**Stop if** a what-if scenario's direction is wrong — reports improvement
where you know the real system would degrade, or vice versa. That implicates
the engine's mechanism, not an absolute number nobody claimed to know, and is
much cheaper to learn now than after a UI exists.

## Working notes for AI assistance

- The engine is where you are least reliable — physical modelling has no
  compiler to catch a wrong assumption. Extend it only with a paper-derived
  test alongside.
- The UI, layout, forms, and billing are safe to generate freely.
- When adding a component kind: add to `ComponentKind`, give it a
  `ComponentProfile` (servers + service time), decide `outflowFactor` and
  whether it is an async boundary, then add findings with numeric evidence.
- Findings must include what to change (`connectionsRequired`,
  `consumersRequired`), not just what broke.

## Known modelling gaps

Stated so they can be added rather than silently assumed away:

- Synchronized cache expiry (deploy/flush) is far worse than the steady-state
  herd model and is not represented.
- `c > 1` p99 adds mean service time to the waiting quantile, understating the
  tail. Fix with a convolution if calibration demands it — never a fudge factor.
- No retries, circuit breakers, or autoscaling lag. Cycles are rejected.
- M/M/c throughout: Poisson arrivals, exponential service, no batching, no
  coordinated omission. Real systems violate all of these. The UI must say the
  numbers are directional.

## Bugs already found and fixed — do not reintroduce

- Herd model keyed off aggregate load, in which the hot-set term cancels, so
  hot-set size had no effect. Damage is N duplicate in-flight queries for one
  key, driven by refill time.
- Async boundary leaked consumer service time into caller latency.
- Replication lag fired at break-even reporting "0 seconds per second" as its
  own evidence. Technically true, reads as broken. Now requires a 1% deficit.
- The inference tool schema (`packages/engine/src/inference/fromProse.ts`)
  failed against a live API four separate ways before the first real call
  succeeded: wrong JSON Schema target (OpenAPI's boolean `exclusiveMinimum`
  isn't draft 2020-12), `strict: true`'s constrained decoding rejecting
  numeric bound keywords outright, a compiled-grammar-too-large error from
  inlining the repeated `Parameter` sub-schema ~20 times instead of
  `$ref`-ing it, and no `strict: true` at all initially — which let the
  model wrap valid output in a spurious key instead of matching the schema.
  All four are covered by `packages/engine/tests/toolSchema.test.ts` against
  `ajv`'s 2020-12 meta-schema, offline.
- A cache's capacity was computed from `hitLatencyMs` — the client-observed
  round trip, dominated by network transit for a remote cache — instead of
  the server's actual per-op busy time. A 1ms cache modelled this way had a
  hard ceiling of 1,000 rps, orders of magnitude below real single-instance
  Redis throughput. Worse, `deriveFindings` had no case for a saturated
  cache at all, so a cache pinned at Infinity latency reported the whole
  system as healthy — silently, and undetected by the existing golden
  tests, since none of them checked a cache's own utilization. Confirmed
  live in the checked-in `urlShortener` reference model at its own
  golden-tested 10,000 rps. Fixed by splitting `hitLatencyMs` (still what's
  reported as latency) from a new `cpuTimeMs` (what determines capacity),
  and adding the missing `CACHE_SATURATED` finding.
  `packages/engine/tests/cacheCapacity.test.ts` is a hand-derived regression
  test for exactly this failure mode.
