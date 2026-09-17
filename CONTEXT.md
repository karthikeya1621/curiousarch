# CONTEXT.md

Context for AI-assisted development. Read before proposing changes.

## What this is

An architect-in-a-box for distributed systems. The user describes a system
in prose (or picks a reference example); we infer a rough model — categories
and yes/no facts, never numbers — render it as a flow diagram, and flag real
architectural risk patterns on it: single points of failure, thundering
herds, cascading failures, unbounded admission. Clicking a marker offers
fixes; choosing one patches the model and re-simulates to show whether the
specific risk actually cleared.

**This is categorical, not numeric.** The engine used to run precise
queueing simulation (M/M/c, Erlang B/C) over inferred magnitudes
(`queryTimeMs: 25`, `connectionPoolSize: 240`). It doesn't anymore — that
architecture is documented below under "Superseded: the numeric queueing
engine" because the reasoning that killed it matters for anyone tempted to
bring precision back. The current engine pattern-matches over rough,
categorical component traits (`instanceCount: "single" | "multiple"`,
`hasCircuitBreaker: boolean`) and topology shape. **The interaction is
still what-if, not forecast** — a scenario is a hypothetical trait flip
("the replica fails"), not a numeric stress multiplier — but the deeper
reason has changed: it was never really about avoiding a *forecast*, it was
about not asking an LLM to do something it structurally cannot do (measure
a real system's latency from a sentence). See "Why the pivot" below.

**There is no drag-and-drop canvas.** The user never places nodes. Authoring
is prose plus corrections. This is a deliberate product decision, not a
missing feature — do not propose a node palette or a blank canvas.

## The one thing that makes this defensible

Findings are **computed by a deterministic pattern catalogue**
(`packages/engine/src/patterns.ts`), never asserted by an LLM. The LLM may
phrase a finding; it may not decide where one goes. Competitors have a
canvas plus an LLM that narrates architecture opinions; they compute
nothing. If that boundary erodes, this becomes a diagramming tool with
opinions and there is no reason to build it.

This was tested directly, not just asserted: mid-session, an external LLM
(Gemini) was shown a screenshot of this app's own ControlPanel (from the
*old* numeric engine) and asked to explain why the system broke. It
produced a fluent, specific-sounding, and **wrong** causal story — inventing
a mechanism ("replication lag cascades into connection exhaustion") the
engine never computed, and misreading how connection pooling works along
the way. The real cause, read directly off the engine's own evidence, was a
single isolated finding with nothing cascading. This is the exact failure
mode the "computed, not generated" boundary exists to prevent, demonstrated
live by a tool with no such boundary — see "Why the pivot" for how directly
this shaped the categorical rewrite.

Concretely: every `Finding.evidence` value traces to a trait or a topology
shape you can point at in `patterns.ts`. Chat cannot answer an architecture
question without a pattern match behind it.

## Why the pivot (read this before re-adding numbers)

PLAN-0.4 measured whether prose-derived inference produces correct
*absolute* numbers: 30% bottleneck accuracy across 10 comparison runs,
every miss a guessed duration/capacity number off by 5-8x — and critically,
**structure was always right, magnitudes were never trustworthy**. The
original response (documented in the git history, no longer current) was to
keep the numeric queueing engine but stop depending on absolute accuracy —
ask relative what-if questions instead of forecasts, since a relative
question only needs the *math mechanism* to be sound, not the baseline's
numbers to be right.

That response didn't go far enough. The mechanism being sound doesn't help
when the *inputs* to that mechanism are still guessed magnitudes — precise
math on top of a guessed number produces a specific-sounding wrong answer,
which is worse than an honest rough one. The Gemini incident above is what
made this concrete: a fluent explanation citing exact figures (a 98%
utilization number, a specific ops/sec deficit) that were individually
real, stitched into a causal story that wasn't. The user's own framing,
verbatim, is worth preserving: *"my whole concept was not using numbers and
calculations. The app should think like an architect... It was never about
big calculations."* An architect reasons from rough shape and category —
single instance? short cache TTL? no circuit breaker? — not from a
percentage. The fix wasn't better prompting or a bigger repair-retry
budget; it was removing the numbers the LLM was being asked to invent in
the first place. "Does this have a read replica" is a question prose can
actually answer; "what's the query time in milliseconds" never was, no
matter how the schema was tuned.

## Non-negotiable invariants

1. **Findings are computed, never generated.** `evaluatePatterns` in
   `patterns.ts`, called from `solver.ts`. Nothing about this changed in the
   pivot — only what "computed" operates on.
2. **Every trait carries provenance** (`stated` / `inferred` / `default`)
   plus a one-line rationale, and the UI shows both. Prose-derived modelling
   means we are guessing categories, not just numbers; the correction loop
   is what makes that survivable. This matters *more*, not less, post-pivot
   — see the mislabeled-provenance finding under "Known gaps" below.
3. **Severity reflects real consequence, not a threshold crossed.**
   `SINGLE_POINT_OF_FAILURE`/`THUNDERING_HERD_RISK`/`CASCADING_FAILURE_RISK`
   are critical because they describe something that actually breaks when
   it happens, not because a number passed 80%. `UNBOUNDED_ADMISSION`/
   `QUEUE_NO_DEAD_LETTER`/`FIXED_SCALING_AT_SCALE` are warnings — real risk,
   not yet a proven failure. All-critical trains users to ignore critical.
4. **Expected test values are reasoned on paper**, never captured from a
   run. A snapshot locks in a wrong model. Post-pivot this means: a
   pattern's test asserts *exactly which trait combination* triggers it and
   confirms every other combination doesn't — not just "it fired."

## Decisions already made — do not reopen without new information

| Decision | Reason |
|---|---|
| Categorical traits, not numeric parameters | See "Why the pivot" above. An LLM can reliably answer "does this have a replica" from a sentence; it cannot reliably answer "what's the query time in ms," and precise math on top of the latter produces a confidently wrong answer, demonstrated live by the Gemini incident. Don't propose bringing numeric simulation back without new evidence this is actually solved — it isn't a tuning problem. |
| Workload is a rough scale tier, not an rps number | Explicitly confirmed with the user during the pivot: Small/Medium/Large/Massive only, no number shown or edited anywhere. `findBreakingTier` steps through the four tiers rather than binary-searching a range. |
| Six patterns in v1, not fifty | Each one is real, well-known architectural wisdom (SPOF, thundering herd, cascading failure, unbounded admission, no DLQ, fixed scaling at scale) that earns its place. Padding the catalogue for coverage produces exactly the "plausible-sounding" risk this whole approach exists to avoid — a new pattern should be added because it's a real, checkable piece of wisdom, not to hit a round number. |
| TypeScript engine, not Rust/Wasm | Tens of components, one pattern pass per interaction — trivially fast regardless of language. Engine is isolated so it can be swapped if profiling ever says otherwise (it won't need to). |
| No drag-and-drop | The crowded lane. SysSimulator and ~8 others already do canvas + simulation, free. |
| React Flow for rendering | Still needed for nodes/edges/click targets. Layout is programmatic (ELK). |
| ELK.js with pinned node identity | Must animate, not repaint. Regeneration is frequent here, so instability is worse than in a drag tool. |
| Chat is for correction, not Q&A | Its job is fixing inferred traits. Findings come from the pattern catalogue, never from chat. |
| Credits, not subscription | Usage is bursty and low-frequency; subscription fights the pattern. |

## Current state

The engine pivot (categorical traits + pattern catalogue, replacing the
numeric queueing engine) is complete and verified: 60 engine tests + 9 web
tests passing, typecheck clean across both workspaces, full `/run-web`
verification of the diagram/indicator/failure/fix/apply/undo loop on all
three reference models, and one live `fromProse` smoke call producing a
genuinely expert-quality result (see "Verified live" below). The repo is
still an npm workspaces monorepo: `packages/engine/` and `apps/web/`.

Engine (`packages/engine/`):

- `src/index.ts` — public entrypoint; import from here, not individual files
  (excludes `src/inference/*`, reachable server-side via `src/server.ts`)
- `src/server.ts` — server-only entrypoint (`@archsim/engine/server`) for
  `fromProse`, used by `apps/web/app/api/infer/route.ts`
- `src/types.ts` — `Trait<T>` (replaces the old `Parameter`; same
  provenance/rationale contract, generic over category instead of number),
  `Component`/`SystemModel`/`ScaleTier`, the shared `isTrait` guard
- `src/patterns.ts` — **the engine now**: six pattern functions, each a
  pure predicate over traits and topology, producing `Finding[]`
- `src/components.ts` — down to just `isAsyncBoundary` (a queue is where a
  synchronous failure chain stops); the numeric capacity model that used to
  live here is gone
- `src/solver.ts` — `simulate()` (cycle check + run every pattern),
  `findBreakingTier()` (step through the four scale tiers)
- `models/reference.ts` — three hand-modelled systems spanning the
  severity spectrum: checkout (one critical finding at baseline — a real,
  common gap, not contrived), url-shortener (a different critical finding),
  media-upload (healthy, but with real warnings — the "warnings before
  failure" point still has to hold)
- `src/inference/schema.ts`, `prompt.ts`, `fromProse.ts` — prose in,
  `SystemModel` out; every trait is a boolean or a small enum, never a
  number; same tool-use + validation + one-repair-retry harness as before
- `src/whatif.ts` — scenario catalogue (each scenario flips one trait
  toward its riskier value, or steps the workload up one tier) +
  apply/compare + `setTraitValue` (a user correction, marks the field
  `"stated"`)
- `src/fixes.ts` — fix catalogue keyed by finding code, each fix flips a
  trait toward its safer value + apply-fix-then-resimulate
- `bin/sim.ts`, `bin/whatif.ts` — CLI harnesses (prose or `--model <id>`,
  `--scale <tier>`; indicator → failures → fixes with tradeoffs → resimulate)

UI (`apps/web/`): same shape as before the pivot, different content —
`lib/store.ts`'s `updateTrait`/`setWorkloadScale` replace
`updateParameter`/`setWorkloadRps` (identical push-history/undo semantics),
`ControlPanel.tsx` renders a toggle switch per boolean trait and a
two-option segmented control per enum trait instead of numeric inputs,
`ComponentNode.tsx` shows a subtle amber ring instead of a `×N` badge when
a service/database is a single-instance risk, `SystemDashboard.tsx` reports
"breaks at `<tier>` scale" instead of an rps figure, and
`components/UtilizationTable.tsx` is deleted (there's no numeric
utilization left to show). The diagram, the indicator → failure → fix →
resimulate interaction loop, `Card`/`Badge`/the per-kind icon set, and
`FindingsCompareTable`'s code-presence grid are all **unchanged** — none of
it ever depended on how a finding was computed, only on `Finding[]` being
diffable.

**Verified live** (one `fromProse` call, `bin/sim.ts`, "Movie ticket
booking system with 1M users"): produced a 6-component model (gateway,
booking service, seat cache, booking database, booking queue) with a direct
`booking-service -> booking-db` write path alongside the
`-> seat-cache -> booking-db` read path — a genuinely sophisticated,
correct topology — and flagged, correctly: `SINGLE_POINT_OF_FAILURE` on the
write-heavy database (no replica), `THUNDERING_HERD_RISK` on the seat
cache (short TTL, small keyspace, no stampede protection),
`CASCADING_FAILURE_RISK` on a 4-deep synchronous chain with no circuit
breaker, plus two warnings (no dead-letter queue, fixed consumer scaling at
large scale). Every provenance label was correctly categorized (no
mislabeling this run). This is the bar this approach needs to clear, and it
cleared it on the first post-pivot live call.

## Superseded: the numeric queueing engine

Deleted in the pivot, not archived — the reasoning above is why, and git
history preserves the code if it's ever needed as a reference. For as long
as anyone might go looking for it: it lived in `src/queueing.ts` (Erlang
B/C, M/M/c, response quantiles), `src/components.ts`'s `capacityOf`/
`evaluate`/`profileOf`/`outflowFactor`, and `solver.ts`'s `propagateLoad`/
`criticalPath`. `findBreakingPoint` (binary search over rps) is now
`findBreakingTier` (step through four scale tiers). `bin/check-inference.ts`
and `bin/run-comparison.ts` (PLAN-0.4's numeric-diffing comparison
tooling) are deleted outright — the methodology (diff an inferred model's
exact numbers against a hand-built oracle) doesn't apply to a categorical
model, and `packages/engine/docs/inference-log.md` remains as the
historical record of what that methodology found.

## Next task

Both the original Phase 0/1 build-out and this session's engine pivot are
done. What's genuinely still open:

- **Phase 1's closing question** ("does the loop produce a moment of
  insight, or does it produce a diagram?") still hasn't been answered by a
  human other than the user, and the pivot makes this worth re-asking fresh
  — the loop's *content* changed even though its shape didn't.
- **0.5** (running the flow against a system you've personally operated)
  remains a known, accepted gap — see the git history for the pre-pivot
  attempts at this. Worth doing opportunistically if a future session gets
  the chance, especially now that the categorical model is much more
  likely to produce something an operator would recognize as correct.
- **The pattern catalogue is six patterns, not an exhaustive list.** Real
  architectural wisdom not yet covered here: idempotency/retry safety,
  multi-region/single-region risk, secrets/credential handling, observability
  gaps. Add a pattern when you have a specific, well-known piece of wisdom
  to encode — not to hit a round number (see the "six, not fifty" decision
  above).
- No Phase 2 planning (auth, payments, persistence, sharing) has happened.
  Not a commitment, don't start any of it without a plan first.

**Stop if** a what-if scenario's direction is wrong — reports a fix helping
when you know it wouldn't, or a scenario as safe when it's actually the
risky one. That implicates a pattern's own logic, not a guessed number, and
is much cheaper to learn now than after more patterns are built on top of it.

## Working notes for AI assistance

- The pattern catalogue (`patterns.ts`) is where you are least reliable —
  each pattern is a claim about real architectural wisdom, not just code
  that type-checks. Extend it only with a specific, well-known failure mode
  in mind, a hand-derived test asserting exactly when it fires and when it
  doesn't (both directions), and evidence text that names the actual
  mechanism, not just "this looks risky."
- The UI, layout, forms, and billing are safe to generate freely.
- When adding a component kind: add to `ComponentKind`, give it its 1-3
  categorical traits (not more — see the schema design in `types.ts`), add
  it to `inference/schema.ts` and `prompt.ts`, decide whether it's an async
  boundary (`isAsyncBoundary`), then decide which existing patterns should
  now also check it (or whether it needs a new one).
- Findings must include which trait(s) combined to produce the verdict
  (`Finding.evidence`), not just a severity and a code — the UI renders
  this evidence directly, unphrased.
- Every enum trait in the current schema has exactly two options. If a
  third is ever needed, `apps/web/components/ControlPanel.tsx`'s
  `SegmentedToggle` already generalizes to N options — the constraint is
  in the trait design, not the UI.

## Known gaps

- **The pattern catalogue is deliberately small (six patterns) and
  deliberately shallow per pattern** (e.g. `CASCADING_FAILURE_RISK` only
  checks for *a* circuit breaker anywhere in the chain, not whether it's
  configured sensibly). This is intentional scope discipline, not an
  oversight — see "six, not fifty" above.
- **One observed instance of mislabeled provenance**, from the pre-pivot
  numeric model but structurally identical risk here: a clearly-guessed
  value tagged `"stated"` instead of `"default"`. `prompt.ts` was tightened
  with an explicit self-check ("if your rationale admits a guess, the
  provenance can't be 'stated'") — not yet re-confirmed with a live run
  against the *categorical* schema specifically (the one post-pivot live
  call had zero mislabeling, but n=1 isn't a pattern).
- **Run-to-run inference variance is real** (pre-pivot: 2 of 7 identical
  prompts returned a near-empty model; live latency ranged ~4s-60s call to
  call). The categorical schema is expected to reduce the "near-empty
  model" failure mode specifically (harder to accidentally under-specify a
  yes/no fact than a plausible-sounding number), but this hasn't been
  measured at volume yet.

## Bugs already found and fixed — do not reintroduce

Pre-pivot bugs in the numeric queueing engine are kept here as institutional
memory even though that code is gone — the *shape* of several of these
mistakes (a shared schema object needing explicit hoisting, a stripped
finding case for a component kind) recurred in the pattern engine and are
exactly why this list is worth reading before touching `patterns.ts` or
`inference/schema.ts`.

- Herd model keyed off aggregate load, in which the hot-set term cancels, so
  hot-set size had no effect. Damage is N duplicate in-flight queries for one
  key, driven by refill time. (Numeric-engine era; the categorical
  `THUNDERING_HERD_RISK` pattern encodes the same lesson structurally:
  small keyspace + short TTL + no protection, no cancellation possible.)
- Async boundary leaked consumer service time into caller latency.
  (Numeric-engine era latency-specific bug; not applicable post-pivot, no
  latency is computed — but `isAsyncBoundary` itself, the mechanism that
  bug lived next to, is exactly what `CASCADING_FAILURE_RISK` relies on to
  know where a synchronous chain stops.)
- Replication lag fired at break-even reporting "0 seconds per second" as
  its own evidence. Technically true, reads as broken. (Numeric-engine era;
  the general lesson — evidence text must never read as self-contradictory
  or trivially true — applies to every pattern's evidence string now.)
- The inference tool schema failed against a live API **four separate ways**
  in the numeric era (wrong JSON Schema target, `strict: true` rejecting
  numeric bounds, a too-large compiled grammar from an un-hoisted repeated
  sub-schema, no `strict: true` at all initially), and **two more ways**
  discovered rewriting the schema for the categorical pivot:
  - `components.array(...).min(2)` directly on `SystemModelSchema` looked
    safe (`.min(1)` was already live) but 400'd immediately: strict mode's
    constrained decoding rejects array `minItems` above 1 outright. Fixed
    by keeping the wire schema at `.min(1)` and moving the real "at least
    one component beyond the gateway" check into `superRefine`, which
    was already known not to be translated into the schema sent to the API.
  - Hoisting `BooleanTraitSchema` into `definitions` (needed because it's
    reused across four fields) wasn't enough on its own: `ProvenanceSchema`
    is *also* reused, nested inside every single trait schema including the
    enum ones, and needed its own `definitions` entry — the error
    ("Reference to non-existent definition:
    #/definitions/BooleanTrait/properties/provenance") only appeared after
    fixing the first issue, live. **The general lesson, twice-confirmed
    now:** any Zod object instance reused across two or more fields needs
    an explicit `definitions` entry, no matter how small or how nested —
    "it's just a boolean" is not a reason to skip this.
  All six are covered by `packages/engine/tests/toolSchema.test.ts` against
  `ajv`'s 2020-12 meta-schema, offline — including a test specifically
  asserting every `$ref` is an *exact* top-level definitions entry
  (`^#/definitions/[^/]+$`), not just prefix-matched, because the second
  bug above would have slipped past a looser check.
- A cache's capacity was computed from `hitLatencyMs` instead of actual
  per-op busy time, understating real throughput by orders of magnitude,
  and `deriveFindings` had no case for a saturated cache at all — silently
  healthy. (Numeric-engine era; not applicable post-pivot, but the general
  lesson — a component kind with no finding case for its own failure mode
  fails silently, not loudly — is exactly why every pattern in
  `patterns.ts` needs a negative-case test proving it does NOT fire when it
  shouldn't, not just a positive case proving it does.)
- `apps/web`'s flow diagram silently dropped every edge referencing a
  component absent from the *previous* model on every reference-model
  switch. Cause: React Flow's `onEdgesChange` evaluates edges against an
  internal node lookup that lags one render behind a freshly-set `nodes`
  array. Fixed by not wiring `onEdgesChange` (nothing in this app lets a
  user drag/delete an edge) and making `lib/animateNodes.ts` apply its
  first frame synchronously. Still applies post-pivot — this is UI
  plumbing, untouched by the engine rewrite.
