# CONTEXT.md

Context for AI-assisted development. **Read this index first; it is short on purpose.** Detail lives in `docs/context/`, split by topic so you can load only what a task needs.

## Where to find things

| If you are working on… | Read |
|---|---|
| Why the model is categorical, why numbers were removed, why findings are AI-generated, the deleted engines | [`docs/context/history-and-pivot.md`](docs/context/history-and-pivot.md) |
| Product principles (AI judges, code validates), the tier ladder, no drag-and-drop, the tech stack, pricing | [`docs/context/product-decisions.md`](docs/context/product-decisions.md) |
| Anything that stops a wrong result reaching the user: retries, continuity checks, the final gate, friendly errors, identity cleaning | [`docs/context/inference-reliability.md`](docs/context/inference-reliability.md) |
| Tiers, instance counts, baseline protections, the minimal start, one rung per Re-simulate | [`docs/context/scale-and-minimal.md`](docs/context/scale-and-minimal.md) |
| Wiring: CDN direction, load balancers, parallel paths, lint rules, the data path, broker rules | [`docs/context/topology-rules.md`](docs/context/topology-rules.md) |
| Findings (typed fields, area decisions, graph facts, ranking), chat intent classification, the Sonnet-vs-Opus decision | [`docs/context/findings-and-chat.md`](docs/context/findings-and-chat.md) |
| Routing, login redirects, autosave, leaving a project, usage tracking, the admin dashboard and the guest trial | [`docs/context/web-app-decisions.md`](docs/context/web-app-decisions.md) |
| Where the money goes and the cost levers | [`docs/context/cost-and-usage.md`](docs/context/cost-and-usage.md) |
| What has been verified live, the eval scripts, what is still unverified | [`docs/context/live-testing-log.md`](docs/context/live-testing-log.md) |
| Older bugs whose shape recurs (schema hoisting, strict-mode limits, React Flow edges) | [`docs/context/bug-log.md`](docs/context/bug-log.md) |
| Launch review: the multi-agent production-readiness pattern, the six specialist briefs, the report format, deployment steps | [`docs/orchestration/README.md`](docs/orchestration/README.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Roadmap | `plans/PLAN-4.md` onward |
| *Optional:* resuming after a break - where work stopped, open items, tooling problems (a local, gitignored note; may not exist) | [`docs/HANDOFF.md`](docs/HANDOFF.md) |

**Adding a decision:** put it in the topical file it belongs to as a new `##` section (decision as the heading, reason and evidence as the text), newest last. Only put something here if it changes the orientation below. Keep test counts current in this file, `README.md` and `plans/PLAN-4.md`.

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
architecture is documented in `docs/context/history-and-pivot.md` ("Superseded: the
numeric queueing engine") because the reasoning that killed it matters for anyone tempted to
bring precision back. The current engine pattern-matches over rough,
categorical component traits (`instanceCount: "single" | "multiple"`,
`hasCircuitBreaker: boolean`) and topology shape. **The interaction is
still what-if, not forecast** — a scenario is a hypothetical trait flip
("the replica fails"), not a numeric stress multiplier — but the deeper
reason has changed: it was never really about avoiding a *forecast*, it was
about not asking an LLM to do something it structurally cannot do (measure
a real system's latency from a sentence). See "Why the pivot" in `docs/context/history-and-pivot.md`.

**There is no drag-and-drop canvas.** The user never places nodes. Authoring
is prose plus corrections. This is a deliberate product decision, not a
missing feature — do not propose a node palette or a blank canvas.

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
   — see the mislabeled-provenance finding under "Known gaps" further down.
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

## Working principles that recur

- **Judgment belongs to the AI; code enforces validity.** Structural rules (no dangling edges, no lost components, stated values kept, minimal at the lowest tier) live in code and in the final gate; design judgments (is a CDN origin sensible, is a shared database a risk) do not. Full statement: `docs/context/product-decisions.md`.
- **Nothing wrong reaches a paying user.** Every build and Re-simulate result passes `finalGate.ts`; a failure retries once and then falls back to the previous version. `docs/context/inference-reliability.md`.
- **Stay on Sonnet 5.** Depth comes from scaffolding (per-area decisions, graph facts, ranking), not a bigger model. `docs/context/findings-and-chat.md`.
- **No paid live runs unless asked; report their cost.** `docs/context/live-testing-log.md`.

## Current state

The app is a working, full-loop product, not a prototype: describe a system
in prose, get a diagram with AI-identified findings and fixes, apply fixes
or chat free-form to queue changes to it, Re-simulate to apply everything queued, save/reopen
multiple projects across sessions. 658 tests passing (317 engine + 341 web),
typecheck clean across both workspaces, pushed to `origin/main`.

**Auth + persistence.** Magic-link email and Google login (client-side
Google Identity Services, not a redirect through Supabase's own domain —
deliberately chosen so the consent screen shows this app's real origin),
gated by `apps/web/proxy.ts`. Every project is a row in a Postgres
`projects` table (`apps/web/lib/sessionStorage.ts`), not localStorage.
Multi-project support (`ProjectsCard.tsx`, save/load/list/delete) lets a
user hold several systems at once and switch between them.

**Auto-save, not a Save button.** `AutoSaveIndicator.tsx` persists on a
debounce (1500ms) keyed off a single `autosaveRevision` counter
(`lib/store/slices/projectSlice.ts`), bumped by every action the store considers save-worthy — a
build, a chat reply, queueing a fix, a Reset, restoring a version, a completed
Re-simulate. Moving the workload-tier slider deliberately does **not** bump
it (a parameter change to review, not to persist or redraw the canvas for
on its own — see `FlowDiagram.tsx`'s matching `components`/`edges`-only
layout dependency); only an explicit Re-simulate commits it.

**Findings are AI-generated**, not pattern-matched — see
`docs/context/history-and-pivot.md` for the full history of that decision. `identifyFailures.ts` is the sole
findings source, called after every real model change.

**Twelve component kinds across two structured calls.** Five base kinds
(gateway/service/cache/database/queue, `inference/schema.ts`) plus seven
extended kinds (external dependency, load balancer, message broker, CDN,
object storage, scheduled job, config store — `inference/
extendedComponents.ts`), kept in a separate call because the base topology
schema was already at Anthropic's strict-mode compiled-grammar size limit
before the seven existed. Both propose (on Build) and revise (on
Re-simulate) preserve existing components/edges by default rather than
regenerating them from scratch — a real regression, found and fixed live
earlier this project's history, is why that "preserve by default" language
is explicit in both `REWORK_PROMPT` and `REVISE_PROMPT`.

**Guardrails, not just bigger `max_tokens`.** `MAX_BASE_COMPONENTS` (15),
`MAX_EXTENDED_COMPONENTS` (6), `MAX_TOTAL_COMPONENTS` (21) are enforced at
the schema level (rejection + repair retry) and again defensively in code:
a description-length cap on Build (`apps/web/lib/limits.ts`), and a
pre-flight warning in `ResimulateButton.tsx` when a model is within 2
components of the cap.

**Builds start at the basic tier, not pre-scaled for a stated target.**
`workloadParameters.ts` has always snapped a stated number ("1M users") to
a target while starting the actual tier at the lowest rung; the topology
and extended-component prompts were later made to match that same
philosophy — a "1M users" description still produces `instanceCount:
"single"`, not architecture pre-built for the eventual scale.

**UI**: two-column layout (Controls + Dashboard), chat as a floating
widget (`ChatWidget.tsx`, backed by `chatWithProject.ts` — one free-text
message in, the AI itself decides whether it's a question to answer or a
change to make), Re-simulate as a canvas overlay, version history as a
header dropdown with real timestamps, full dark mode with a manual
Light/Dark/System toggle (`ThemeToggle.tsx` in `AccountMenu.tsx`).

**Deleted, not extended:** the deterministic pattern-matching engine
(`patterns.ts`/`solver.ts`/`whatif.ts`/`fixes.ts`, plus a `fixes.ts`-only AI
helper, `proposeCacheTraits.ts`) is gone outright — see git history for its
final form, and "Findings are AI-generated" in `docs/context/history-and-pivot.md` for why it was safe to
remove rather than extend for the newer component kinds it never gained
pattern logic for.

## Next task

Auth, persistence, multi-project support, the UX redesign, and the 7
extended component kinds are all done and live. The phased plan for what's
next lives in `plans/PLAN-4.md` onward, not here, so this list doesn't
duplicate (and drift out of sync with) that document again — the previous
version of this section did exactly that. In short: PLAN-4 (validate with
real outside users and audit finding quality at volume), PLAN-5
(shippable — cost instrumentation, credits, payments), PLAN-6 (earn trust —
demonstrable finding quality, replacing the deleted engine's numeric
calibration). `plans/PLAN-0.md` through `PLAN-3.md` covered the work
that's now shipped and were deleted rather than kept as a stale roadmap —
see git history if you need them.

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
