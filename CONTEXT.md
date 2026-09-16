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

Phase 0 and Phase 1 complete (see `plans/PLAN-0.md`, `plans/PLAN-1.md` — every
section there now carries a **Met**/status note against what's actually
built). 81 engine tests + 6 web tests passing, typecheck clean across both
workspaces. The repo is an npm workspaces monorepo: `packages/engine/`
(everything that was previously at the repo root — `src/`, `models/`,
`tests/`, `bin/`, `docs/`, unchanged internally, just nested) and `apps/web/`
(Next.js App Router UI, the full interaction loop, real-browser-verified via
the `/run-web` skill). `plans/` and this file stay at the repo root —
project-wide, not engine-specific.

Engine (`packages/engine/`):

- `src/index.ts` — public entrypoint; import from here, not individual files
  (excludes `src/inference/*`, which stays server-side — reachable instead
  via `src/server.ts`, see below)
- `src/server.ts` — server-only entrypoint (`@archsim/engine/server`) for
  `fromProse`; the only sanctioned door into `src/inference/*` from outside
  the package, used by `apps/web/app/api/infer/route.ts`
- `src/types.ts` — `Parameter`/`Component`/`SystemModel` shapes, plus the
  shared `isParameter` guard (hoisted here so the CLI and the UI's
  `ControlPanel` don't each carry their own copy)
- `src/queueing.ts` — Erlang B/C, M/M/c, response quantiles, Little's Law
- `src/components.ts` — per-component capacity models, `isAsyncBoundary`
- `src/solver.ts` — propagation, critical path, findings, `findBreakingPoint`
- `models/reference.ts` — three hand-modelled systems, used as the oracle
- `src/inference/schema.ts`, `src/inference/fromProse.ts` — prose in,
  `SystemModel` out; tool-use + validation + one repair retry
- `src/whatif.ts` — scenario catalogue + apply/compare + `setParameterValue`
  (a user-supplied correction, marks the edited field `"stated"`)
- `src/fixes.ts` — fix catalogue keyed by finding code + apply-fix-then-resimulate
- `bin/sim.ts`, `bin/whatif.ts` — CLI harnesses (prose or `--model <id>`;
  indicator → failures → fixes with tradeoffs → resimulate)

UI (`apps/web/`):

- `lib/store.ts` — Zustand: `model`, a flat `history` undo stack,
  `selectedScenarioId`/`selectedFixId`/`openComponentId` (cross-component UI
  selection state), and the mutators (`setModel`, `updateParameter`,
  `setWorkloadRps`, `undo`, `selectScenario`, `selectFix`,
  `setOpenComponentId`)
- `lib/hooks.ts` — `useScenarios`/`useScenarioDelta`/`useFixes`/
  `useFixResult`/`useBreakingPoint`, every engine call memoized and
  try/catch-guarded so a stale selection can't crash a render
- `lib/layout.ts` — ELK adapter (layered, left-to-right); synthesizes a
  `__traffic__` node upstream of any component with no incoming edge, so
  workload-level scenarios (traffic spikes) have somewhere to live in the
  diagram
- `lib/animateNodes.ts` — rAF/lerp position interpolation across a relayout
  (no library does this — see PLAN-1.4's notes on the gotcha this hit)
- `components/FlowDiagram.tsx`, `ComponentNode.tsx`, `TrafficNode.tsx`,
  `FailureIndicator.tsx` — the diagram; badge click sets `openComponentId`,
  never renders a popover on the canvas itself (anything absolutely
  positioned off a node gets clipped by React Flow's pannable viewport)
- `components/ControlPanel.tsx` — every `Parameter`, grouped by component,
  editable, with a provenance badge; traffic slider ranged around
  `findBreakingPoint`; undo button
- `components/FailureSidebar.tsx`, `FailurePanel.tsx`, `FixResultPanel.tsx`,
  `FindingsList.tsx`, `UtilizationTable.tsx` — the indicator → failure → fix
  → resimulate detail, rendered in the sidebar (not inline in a diagram node)
- `components/ProseInput.tsx`, `app/api/infer/route.ts` — prose textarea →
  `POST /api/infer` → `setModel`
- `components/SystemDashboard.tsx`, `app/page.tsx` — page assembly

`findBreakingPoint` backs the constraint sliders and is shown next to the
health badge. The user's question is "where does this fall over", not "is
50k fine".

## Next task

PLAN-0 and PLAN-1 are both done. 0.5 (run the flow against a system you've
personally operated, to check whether the what-if deltas ring true) was
explored with invented example systems rather than a real operated one —
useful for exercising the mechanism (see
`packages/engine/docs/inference-log.md` runs 8/10, and the ride-hailing
example in-session), but it doesn't carry the evidentiary weight true 0.5
would. **This is a known, accepted gap, not an oversight** — if a future
session has the chance to run the flow against a real system with a real
operator judging the result, that's still the strongest test available and
worth doing opportunistically.

Phase 1's own closing question ("does the loop produce a moment of insight,
or does it produce a diagram?") hasn't been answered by a human other than
the user yet — everything verified so far is mechanism-correctness
(`/run-web`, hand-derived engine tests), not the subjective judgment PLAN-1
asks for at the end. That's the honest next step before treating Phase 1 as
fully closed, separate from the fact that every acceptance criterion in
`plans/PLAN-1.md` is now met or explicitly superseded.

No Phase 2 planning has happened yet. `plans/PLAN-1.md`'s own "Out of scope"
list (auth, payments, persistence, chat, sharing, more component kinds) is
the candidate list, not a commitment — don't start any of it without a
PLAN-2 first.

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
- `apps/web`'s flow diagram silently dropped every edge referencing a
  component absent from the *previous* model on every reference-model
  switch. Cause: React Flow's `onEdgesChange` evaluates edges against an
  internal node lookup that lags one render behind a freshly-set `nodes`
  array, and dispatches a permanent "remove" change for an edge whose
  endpoint isn't in that lookup yet — even when the node arrives moments
  later in the same render pass. Compounded by the node-position animation
  (`lib/animateNodes.ts`) originally deferring its first `setNodes` call
  into a `requestAnimationFrame` callback, widening the gap between when
  `edges` and `nodes` became consistent. Fixed two ways together: dropped
  the `onEdgesChange` wiring entirely (nothing in this app lets a user
  drag/delete an edge, so there's no change to apply), and made
  `animateNodes` apply its t=0 frame synchronously so node topology and
  edges always land in the same commit. See `plans/PLAN-1.md`'s 1.4 section
  for the full account.
