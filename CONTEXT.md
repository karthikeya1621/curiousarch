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

## Findings are AI-generated — a later, deliberate reversal of this section's original claim

**Historical note, kept because the reasoning still matters:** this section
originally said findings were "computed by a deterministic pattern
catalogue, never asserted by an LLM" — `packages/engine/src/patterns.ts`,
built specifically because an external LLM (Gemini), shown a screenshot of
this app's own output and asked to explain why the system broke, produced a
fluent, specific-sounding, and **wrong** causal story: inventing a mechanism
("replication lag cascades into connection exhaustion") the engine never
computed, and misreading how connection pooling works along the way. That
incident is real and is preserved below under "Why the pivot" — it's why
`patterns.ts` was built in the first place, and why "computed, not
generated" was treated as non-negotiable for a long stretch of this
project's history.

**That boundary was later, explicitly reversed.** The web app's actual,
current findings source is `packages/engine/src/inference/
identifyFailures.ts` — one free-form AI call given the model as context,
asked to reason like a senior architect and name real risks with evidence
pointing at specific traits. `patterns.ts`/`solver.ts`/`whatif.ts`/
`fixes.ts` (the deterministic catalogue this section used to point at) have
been deleted outright — see git history for their final form. This wasn't
drift or an oversight: it's documented in `identifyFailures.ts`'s own top
comment as an explicit, informed decision — "fully AI-generated, no need
verification... it should think how a human senior architect thinks" — made
*after* weighing the exact Gemini-incident risk this section describes, and
choosing to accept it anyway. The deciding factor was that the deterministic
catalogue structurally couldn't keep up with what the AI-driven model could
represent (most visibly: the extended component kinds it never gained
pattern logic for before being deleted).

**What this means for anyone reading this file:** don't assume a
`Finding.evidence`-style guarantee still exists — it doesn't. An
`AiFinding`'s `explanation` is exactly the kind of LLM-authored narrative
this section used to warn against; that's now the whole findings mechanism,
not a boundary violation. If you're evaluating whether to add verification
back (a schema-level sanity check, a second AI pass, anything short of a
full deterministic engine), that's a live, legitimate question — just don't
mistake this file's old framing for the current invariant.

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

1. **~~Findings are computed, never generated.~~ Superseded — see "Findings
   are AI-generated" above.** Findings now come from `identifyFailures.ts`,
   a free-form AI call. Kept struck through, not deleted, so this doesn't
   silently disappear from the list of things this file once called
   non-negotiable.
2. **Every trait carries provenance** (`stated` / `inferred` / `default`)
   plus a one-line rationale, and the UI shows both. Prose-derived modelling
   means we are guessing categories, not just numbers; the correction loop
   is what makes that survivable. This matters *more*, not less, post-pivot
   — see the mislabeled-provenance finding under "Known gaps" below.
3. **Severity reflects real consequence, not a threshold crossed.** A
   critical finding describes something that actually breaks when it
   happens, not a number passing 80%. All-critical trains users to ignore
   critical. This still holds under `identifyFailures.ts` — its prompt
   asks for the same distinction — but `code`/`title` are now AI-chosen
   strings, not a closed enum (`SINGLE_POINT_OF_FAILURE` and friends were
   `patterns.ts`'s fixed catalogue; that specific list no longer exists).
4. **Expected test values are reasoned on paper**, never captured from a
   run. A snapshot locks in a wrong model. This predates and outlives the
   pattern catalogue: it's why `models/reference.ts`'s fixtures still carry
   hand-written trait rationale even with no pattern engine left to test
   against them, and why any AI-output test in `packages/engine/tests/`
   asserts specific expected values, never "matches what a run produced."

## Decisions already made — do not reopen without new information

| Decision | Reason |
|---|---|
| Categorical traits, not numeric parameters | See "Why the pivot" above. An LLM can reliably answer "does this have a replica" from a sentence; it cannot reliably answer "what's the query time in ms," and precise math on top of the latter produces a confidently wrong answer, demonstrated live by the Gemini incident. Don't propose bringing numeric simulation back without new evidence this is actually solved — it isn't a tuning problem. |
| Workload is a rough tier ladder, not a raw number | **Updated, decision itself unchanged**: no longer the four-rung Small/Medium/Large/Massive `ScaleTier` (deleted along with the pattern engine that read it) — now `users`/`requests`, each a closed ladder (100/10k/1M/100M; 1k/100k/10M/1B) the AI snaps a stated target to. Still never a number the AI computes or the UI lets you type free-form; still starts at the lowest rung regardless of what the description states (see `workloadParameters.ts`). |
| ~~Six patterns in v1, not fifty~~ — superseded | The pattern catalogue this row defended no longer exists (see "Findings are AI-generated" above). The underlying instinct — don't pad coverage for a round number, only add something for a real, checkable piece of wisdom — still applies to `identifyFailures.ts`'s prompt, which explicitly lists a small set of example risk categories rather than an exhaustive taxonomy. |
| TypeScript engine, not Rust/Wasm | Tens of components, one or two AI calls per interaction — trivially fast regardless of language. Engine is isolated so it can be swapped if profiling ever says otherwise (it won't need to). |
| No drag-and-drop | The crowded lane. SysSimulator and ~8 others already do canvas + simulation, free. |
| React Flow for rendering | Still needed for nodes/edges/click targets. Layout is programmatic (ELK). |
| ELK.js with pinned node identity | Must animate, not repaint. Regeneration is frequent here, so instability is worse than in a drag tool. |
| ~~Chat is for correction, not Q&A~~ — superseded | `chatWithProject.ts` now does both deliberately: the AI itself decides whether a message is a question (answered directly, model untouched) or a change request (implemented as a real model update). Findings still never come from chat — a question's answer is prose, not a new finding — but "never Q&A" is no longer true. |
| Credits, not subscription | Usage is bursty and low-frequency; subscription fights the pattern. |

## Current state (historical snapshot — see note before relying on file names)

**This entire section is frozen at the categorical-pivot moment** (traits +
a hand-written pattern catalogue, replacing the numeric queueing engine). A
great deal has happened since that this section never got updated for:
auth, persistence, multi-project support, a full UX redesign, dark mode,
seven additional component kinds, cost guardrails, and — most relevant to
anything else on this page — the pattern catalogue described below
(`patterns.ts`/`solver.ts`/`whatif.ts`/`fixes.ts`, plus their CLI harnesses
`bin/sim.ts`/`bin/whatif.ts`) has since been **deleted outright**, superseded
by `identifyFailures.ts` (see "Findings are AI-generated" above). Treat
every file path below as "what existed at the categorical pivot," not "what
exists now" — check `packages/engine/README.md`'s own Structure section for
the current file layout before editing anything named here.

Engine (`packages/engine/`), as of the categorical pivot:

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

*(`src/patterns.ts`, `src/solver.ts`, `src/whatif.ts`, `src/fixes.ts`,
`bin/sim.ts`, `bin/whatif.ts`, and `ScaleTier`/`findBreakingTier` no longer
exist. `Finding`/`FindingCode` — the closed-enum shape this bullet list
describes — were deleted along with them; the web app's actual findings
type is `AiFinding`, described under "Findings are AI-generated" above.)*

UI (`apps/web/`) as of the categorical pivot: same shape as before the
pivot, different content — `lib/store.ts`'s `updateTrait`/`setWorkloadScale`
replace `updateParameter`/`setWorkloadRps` (identical push-history/undo
semantics), `ControlPanel.tsx` renders a toggle switch per boolean trait and
a two-option segmented control per enum trait instead of numeric inputs,
`ComponentNode.tsx` shows a subtle amber ring instead of a `×N` badge when
a service/database is a single-instance risk, `SystemDashboard.tsx` reports
"breaks at `<tier>` scale" instead of an rps figure, and
`components/UtilizationTable.tsx` is deleted (there's no numeric
utilization left to show). All of this has since been superseded too —
`lib/store.ts` now tracks a much larger surface (projects, chat, versions,
auto-save), and `ControlPanel.tsx`/`SystemDashboard.tsx` have been through a
full UX redesign. Don't use this paragraph as a guide to their current
shape; read the actual files.

**Verified live** (one `fromProse` call, `bin/sim.ts` — since deleted,
"Movie ticket booking system with 1M users"): produced a 6-component model
(gateway, booking service, seat cache, booking database, booking queue)
with a direct `booking-service -> booking-db` write path alongside the
`-> seat-cache -> booking-db` read path — a genuinely sophisticated,
correct topology — and flagged, correctly (via the since-deleted pattern
catalogue): `SINGLE_POINT_OF_FAILURE` on the write-heavy database (no
replica), `THUNDERING_HERD_RISK` on the seat cache (short TTL, small
keyspace, no stampede protection), `CASCADING_FAILURE_RISK` on a 4-deep
synchronous chain with no circuit breaker, plus two warnings (no
dead-letter queue, fixed consumer scaling at large scale). Every provenance
label was correctly categorized (no mislabeling this run). Kept as evidence
the topology-inference call itself was already sound at this point in the
project's history — the findings mechanism that judged it here is gone, but
the topology it judged is the same kind of output `fromProse.ts` still
produces today.

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

## Next task (stale — see note)

This section is frozen at the categorical-pivot moment, before Phase 2
(auth, persistence, multi-project support) — listed below as "not started"
— actually happened. It's kept for its still-relevant closing questions,
not as an accurate list of what's currently open; don't treat "no Phase 2
planning has happened" as true.

- **Phase 1's closing question** ("does the loop produce a moment of
  insight, or does it produce a diagram?") still hasn't been answered by a
  human other than the user, and the pivot makes this worth re-asking fresh
  — the loop's *content* changed even though its shape didn't.
- **0.5** (running the flow against a system you've personally operated)
  remains a known, accepted gap — see the git history for the pre-pivot
  attempts at this. Worth doing opportunistically if a future session gets
  the chance, especially now that the categorical model is much more
  likely to produce something an operator would recognize as correct.
- ~~The pattern catalogue is six patterns, not an exhaustive list~~ —
  moot, the catalogue is deleted. The equivalent question now is whether
  `identifyFailures.ts`'s prompt names enough real risk categories; it's a
  prompt-tuning question, not a catalogue-coverage one.
- ~~No Phase 2 planning has happened~~ — it has: auth, persistence, and
  multi-project support are all built and live.

## Working notes for AI assistance

- `identifyFailures.ts`'s prompt is where you are least reliable — every
  finding it produces is a claim about real architectural wisdom, phrased
  by the AI itself, not verified against anything computed. Changes to its
  prompt should be checked against the same standard the old pattern
  catalogue held itself to: a real, well-known failure mode, not something
  that merely sounds plausible.
- The UI, layout, forms, and billing are safe to generate freely.
- When adding a component kind: decide first whether it belongs in the 5
  base kinds (`inference/schema.ts`/`prompt.ts`, tight on compiled-grammar
  size — see `types.ts`'s `MAX_BASE_COMPONENTS` comment) or the 7 extended
  kinds (`inference/extendedComponents.ts`, its own separate call); give it
  1-3 categorical traits, not more; decide whether it's an async boundary
  (`isAsyncBoundary`). There's no pattern catalogue left to also update.
- An `AiFinding`'s `explanation` should read as a plain-language reason a
  senior architect would actually give, naming the specific trait(s)
  involved — not a generic definition of the risk category. The UI renders
  it directly, unphrased.
- Every enum trait in the current schema has exactly two options. If a
  third is ever needed, `apps/web/components/ControlPanel.tsx`'s
  `SegmentedToggle` already generalizes to N options — the constraint is
  in the trait design, not the UI.

## Known gaps

- ~~The pattern catalogue is deliberately small and shallow~~ — moot, the
  catalogue is deleted. `identifyFailures.ts` has no equivalent "shallow
  check" limitation (it reasons over the whole model each call, not a
  fixed set of narrow predicates) but also no computed guarantee that it
  actually checked something specific — a different kind of gap, not yet
  characterized here.
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

Pre-pivot bugs in the numeric queueing engine, and later the categorical
pattern engine, are kept here as institutional memory even though both are
now gone — the *shape* of several of these mistakes (a shared schema object
needing explicit hoisting, a stripped finding case for a component kind)
has recurred more than once across different engine generations, which is
exactly why this list is worth reading before touching `inference/schema.ts`
or any of the AI-facing prompts.

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
  fails silently, not loudly — applied to every pattern in the
  now-deleted `patterns.ts`, each of which needed a negative-case test
  proving it did NOT fire when it shouldn't, not just a positive case
  proving it did. The analogous risk under `identifyFailures.ts` is an AI
  call that simply never mentions a real risk category — there's no
  equivalent negative-case test possible against a free-form call, which
  is itself worth being clear-eyed about.)
- `apps/web`'s flow diagram silently dropped every edge referencing a
  component absent from the *previous* model on every reference-model
  switch. Cause: React Flow's `onEdgesChange` evaluates edges against an
  internal node lookup that lags one render behind a freshly-set `nodes`
  array. Fixed by not wiring `onEdgesChange` (nothing in this app lets a
  user drag/delete an edge) and making `lib/animateNodes.ts` apply its
  first frame synchronously. Still applies post-pivot — this is UI
  plumbing, untouched by the engine rewrite.
