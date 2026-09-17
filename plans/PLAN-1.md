**Historical record — the interaction loop this phase built (describe →
controls → flow → indicator → choices → patch → re-simulate → delta) is
still exactly how the app works.** But a later pivot rewrote the engine
underneath it from numeric queueing simulation to categorical pattern
matching, so specific identifiers this phase's "Met" notes cite no longer
exist: `Parameter`/`isParameter` → `Trait`/`isTrait`, `updateParameter` →
`updateTrait`, `setWorkloadRps` → `setWorkloadScale`, `findBreakingPoint` →
`findBreakingTier`, and there is no `connectionPoolSize`, rps slider, or
numeric control anywhere in the current `ControlPanel`. See `CONTEXT.md`'s
"Why the pivot" for why, and `packages/engine/README.md` for the current
shape. Treat every "Met" below as true of *the loop*, not of the exact
names.

# PLAN-1.md — The loop

**Goal:** the complete interaction, working, for one person on localhost.
Describe → controls → flow → indicator → choices → patch → re-simulate → delta.

No auth, no payments, no persistence beyond the session. Those are Phase 2 and
adding them here slows down the only thing that matters: whether the loop feels
like anything.

**Prerequisite:** PLAN-0 passed its kill criteria.

---

## 1.1 — Repo structure

Convert to npm workspaces.

```
packages/engine/     what exists today, unchanged
apps/web/            Next.js App Router
```

- Engine keeps its own tests and typecheck. It imports nothing from `apps/`.
- Web imports `@archsim/engine` as a workspace dependency.
- No Turborepo. Two packages do not need a build orchestrator.

**Acceptance:** `npm test` at root runs engine tests; `npm run dev` serves the
app; the app can import and run `simulate()`.

## 1.2 — Engine on the client

The engine is pure computation. It runs in the browser — no round trip, no
server cost, instant slider response.

- LLM calls go through route handlers (`app/api/infer`, `app/api/patch`) so keys
  stay server-side.
- The model lives in a Zustand store. Simulation results are derived state,
  recomputed synchronously on change.

**Acceptance:** changing a constraint re-simulates with no network call. **Met**
— `apps/web/lib/store.ts`'s `updateParameter`/`setWorkloadRps` call the engine's
`simulate()` synchronously client-side; `app/api/infer` (the only LLM-calling
route; `app/api/patch` was never needed since `whatif.ts`/`fixes.ts` already
cover every model transform deterministically) imports `fromProse` from a
server-only `@archsim/engine/server` entrypoint, keeping `ANTHROPIC_API_KEY`
out of the client bundle.

## 1.3 — Derived controls

The differentiator. Constraints come from the inferred model, not a fixed list.

- Each control is backed by a `Parameter`. Render the value, its provenance, and
  its rationale together.
- Inferred values are visually distinct from stated ones and editable in place.
  This is the correction surface; it is not a settings panel.
- Traffic control defaults to a range centred on `findBreakingPoint`, so the
  break is reachable by dragging rather than by typing a number.
- Users can add a custom constraint; it maps to a parameter or it is rejected.

**Acceptance:** two different system descriptions produce visibly different
control sets, and correcting an inferred value changes the verdict. **Met** —
`ControlPanel` enumerates every `Parameter` on every component via
`Object.entries` + the shared `isParameter` guard, so the control set is
whatever the current model actually has (verified: checkout's 3 components
render a different set than media-upload's 4, no per-model UI code). Editing
`connectionPoolSize` down flips the health verdict live, confirmed via
`/run-web`. "Add a custom constraint" is satisfied by this same mechanism
rather than built as a separate affordance — every parameter is already an
editable control, so there is no restricted subset to add one to.

## 1.4 — Flow rendering

React Flow, programmatic layout, no dragging.

- ELK layered, left-to-right.
- **Node identity is stable across re-layout.** Node ids come from the model and
  never change on regeneration. This is the single most important detail in the
  phase.
- Position changes animate. Never repaint.
- Async edges (to a queue) render distinctly — the caller does not wait, and the
  diagram should say so.

**Acceptance:** adding a component via a fix moves existing nodes smoothly and
leaves the reading order intact. Judge this by watching it, not by a test.
**Built and verified, caveat now closed**: `apps/web/lib/layout.ts` (ELK,
layered, `elk.direction: "RIGHT"`), `components/FlowDiagram.tsx`/
`ComponentNode.tsx`, `lib/animateNodes.ts` (rAF/lerp interpolation — no
library supports this; confirmed via research this phase). Node ids are
`component.id` directly, so identity is stable across relayout for free.
The engine's `UNCACHED_DATABASE_AT_SCALE` pattern (added later, see
`packages/engine/README.md`) is the first fix that actually adds a new
component (`withInsertedComponent` in `whatif.ts`, a real cache node) —
verified live via `/run-web`: applying "Add a caching layer" correctly
inserts the node and rewires the edges, no console errors, positions
settle to ELK's newly-computed layout once the 300ms interpolation
finishes.

**A real bug found during that same live check, still open**: at 5 nodes
(traffic + 4 components — checkout-with-a-cache, but also plain
`url-shortener` reached by an ordinary tab switch, no fix involved —
confirmed this isn't specific to fix-triggered changes), `fitView` doesn't
zoom out far enough and the rightmost node is clipped by the diagram
container's edge. The earlier claim above ("no off-screen clipping") held
for the 3-4 node cases it was actually checked against at the time, not
for 5.

**Risk:** ELK reflows by default and does not preserve prior layout. Budget real
time here. If pinning proves unworkable, evaluate WebCola, which supports
incremental layout natively. Decide by the end of this phase — do not carry an
unstable layout into Phase 2. **Resolved**: ELK's reflow-from-scratch behavior
was worked with, not against — `animateNodes` diffs each render's new ELK
positions against the last known on-screen ones and interpolates, rather than
asking ELK to preserve anything. WebCola was not needed.

A real gotcha hit and fixed along the way, worth flagging for whoever touches
this next: wiring React Flow's `onEdgesChange` (the standard pattern) silently
dropped every edge referencing a node from the *new* topology on every model
switch, because React Flow evaluates edges against an internal node lookup
that lags one render behind a fresh `nodes` array, and dispatches a permanent
"remove" change for an edge whose endpoint isn't in that lookup yet — even
though the node arrives moments later in the same pass. Fixed by not wiring
`onEdgesChange` at all (this app never lets a user drag/delete an edge, so
there was nothing to lose) and by applying `animateNodes`' t=0 frame
synchronously rather than deferring it into the first `requestAnimationFrame`
callback, so node topology and edges always land in the same commit. See the
comments in `lib/animateNodes.ts` and `components/FlowDiagram.tsx`.

## 1.5 — Indicators

Markers on nodes, driven entirely by `SimulationResult.findings`.

- Position and severity come from the engine. Never from a model.
- Warnings must appear before failure. `HIGH_UTILIZATION` at 80% is the early
  signal; if users only ever see red, the tool is a failure detector rather than
  a design aid.
- Hover shows the evidence object rendered plainly: the numbers, the assumption,
  the arithmetic. A clone cannot fake a derivation, and this is where trust is
  won or lost.

**Acceptance:** every indicator traces to a finding, and every number on screen
traces to `evidence`. **Superseded by 1.6's pivot, not separately built**: as
1.6 already notes, the shipped indicator is proactive (driven by
`listScenarios`, keyed by component kind — "this node has N things that could
go wrong") rather than gated behind an existing `SimulationResult.finding` at
the current load. The `evidence`-traces-to-numbers half of this acceptance
criterion is still met, just one click deeper: selecting a scenario shows
`FailurePanel`, which renders `Finding.evidence` plainly (arrivalRps,
poolSize, maxSustainableRps, etc. — never phrased or summarized by an LLM).
The diagram carries this forward via `ComponentNode`/`TrafficNode`'s
`FailureIndicator` badge, which now opens a `FailureSidebar` panel (not an
inline card) since a diagram node has no room to grow.

## 1.6 — Fix choices

**Already built and tested in Phase 0** (`src/whatif.ts` + `src/fixes.ts`,
`bin/whatif.ts`), and it's a single flow, not two to reconcile — this is the
original product scope, clarified after PLAN-0.4's result: every node with a
possible failure carries an indicator (proactive — not gated behind an
existing finding); clicking it lists the failures that node could plausibly
suffer (`whatif.ts`'s `Scenario` catalogue, keyed by component kind); picking
one shows the delta *and* the fix catalogue for whatever finding it actually
produced when simulated (`fixes.ts`'s `Fix` catalogue, keyed by finding code,
looked up from the scenario's own result — not hardcoded per scenario);
picking a fix applies failure-then-fix and re-simulates, reporting whether
the *specific* finding the fix targets is gone (`FixResult.resolved`), not a
blanket "everything's fine now" — a fix can clear what it targets while an
unrelated finding persists, and that's shown honestly, not collapsed away.
Port the CLI's exact sequencing (list -> pick failure -> list fixes with
tradeoffs -> pick fix -> resimulate) into the UI rather than re-deriving it;
it was arrived at by testing against real reference systems, including a
case where a fix only delays a failure rather than resolving it
(`queue:capacity-2x`) and one where two unrelated findings share a component
(`CONNECTION_POOL_EXHAUSTED` + `REPLICATION_LAG` on the same DB from one
traffic scenario) — both are in `tests/fixes.test.ts`.

Click an indicator, get options.

- Options come from a **hand-written catalogue keyed by finding code**, not from
  a model. `CONNECTION_POOL_EXHAUSTED` → add pooler, raise pool, add read
  replica, add queue. Maybe fifty entries total across all codes — Phase 0's
  `fixes.ts` has ~13 across 7 codes as a starting subset, not the full list.
- Each option is a deterministic model transform, written by you and tested.
- The LLM's only job is ranking the options for this context and writing one
  sentence of explanation. It never invents the transform.

This is the inversion that makes the product defensible. Generated architecture
advice is a commodity; a computed fix whose effect is proven by re-simulation is
not.

**Acceptance:** each catalogue entry has a test asserting the transform produces
a model that simulates, and that the targeted finding clears. **Met for the
Phase 0 subset** — `tests/fixes.test.ts` asserts every fix scales the right
parameter and, on at least one scenario/fix pair per resolvable code, that
the targeted finding actually clears.

## 1.7 — The delta

**Also already built** (`compareFix` in `src/fixes.ts`) for the failure+fix
case specifically — three-way (baseline / under failure / failure+fix), not
just before/after, since "before" alone doesn't show whether a fix earns its
tradeoff or just changes what's broken. What's still Phase-1-only: rendering
this as UI rather than CLI text, and undo (the CLI has no notion of session
state to undo — every call takes the baseline model fresh).

The payoff. Apply the fix, re-simulate, show what changed.

- Before/after on the metrics that moved: p99, breaking point, utilization.
- Resolved findings disappear; new ones introduced by the fix appear. A pooler
  fixes exhaustion and may surface something downstream — show that honestly.
- Undo restores the prior model exactly.

**Acceptance:** the checkout reference system at 2,000 RPS shows pool
exhaustion, the pooler fix clears it, and the breaking point visibly moves.
**Met, undo included**: `useAppStore`'s `history: SystemModel[]` is a flat
push/pop stack — `updateParameter`/`setWorkloadRps` push the pre-edit model,
`undo` pops and restores it exactly (a full deep-equal prior model, not a
best-effort diff-reverse), no-op when empty. `setModel` (a full model swap —
picking a different reference system, or a fresh prose inference) clears the
stack rather than trying to undo across it, since restoring "the previous
model" after switching systems entirely isn't a coherent user expectation.
`findBreakingPoint`'s result is surfaced next to the health badge in
`SystemDashboard` and visibly updates as the traffic slider or any parameter
changes.

## 1.8 — Three cached examples

Prebuilt systems, served from static JSON, zero inference.

They cost nothing to run, so they can be explored freely — which is what makes
the Phase 2 free tier affordable. Also your demo, and your fallback when
inference is slow.

**Acceptance:** examples load and are fully interactive with no API call.
**Accepted simplification, not built as specified**: the three reference
models (`checkout`, `urlShortener`, `mediaUpload`) already satisfy the
substance of this — zero inference cost, fully interactive, always
available — by being direct TypeScript imports from `@archsim/engine` rather
than static JSON fetched at runtime. Repackaging them as JSON would add a
fetch/parse step with no behavioral difference for the user; not done
because it has no clear benefit, not because it was skipped under time
pressure.

---

## Out of scope

Auth, payments, persistence, chat, sharing, more component kinds. All Phase 2 or
later. If a task here needs one of them, the task is wrong.

## The question this phase answers

After 1.7, run your own system through it and watch someone else do the same.
Does the loop produce a moment of insight, or does it produce a diagram?

Everything after this phase assumes the answer is insight. Be honest about it
before building billing.
