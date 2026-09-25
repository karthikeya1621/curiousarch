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
| ~~Chat is for correction, not Q&A~~ — superseded | `chatWithProject.ts` now does both deliberately: the AI itself decides whether a message is a question (answered directly, model untouched) or a change request. A change request is **queued**, not applied: chat returns a restatement plus a self-contained `instruction`, the store keeps it in `pendingChanges` beside the queued fixes, and Re-simulate (`reworkModel`) implements every queued item together — so the canvas only moves on the one deliberate, billed step. Each queued change keeps the user's exact words and the resolved instruction, and chat is shown the whole queue on every message, so nothing is lost as the conversation scrolls out of the history window. Findings still never come from chat — a question's answer is prose, not a new finding — but "never Q&A" is no longer true. |
| Leaving a project never asks "are you sure?" — it saves first | The old "Start a new project? … save it first" dialog told people to save when there's no Save button (autosave does it), and appeared on the blank home screen where there is nothing to lose. `saveBeforeLeaving` (project slice) now runs before starting a new project or opening another: no-op on a blank canvas, no-op when nothing changed since the last save/load (tracked by `savedRevision`, so browsing doesn't bump a project's "updated" time), otherwise it saves — including a moved tier, which autosave deliberately never triggers but leaving would lose — and only a FAILED needed save (offline, signed out) shows a dialog, worded as a discard-or-stay choice. The "New project" button isn't rendered on the blank home screen at all: describing a system in the box there already creates the project. The projects list shows exactly 3.5 rows (fixed row height, cap derived from it in `lib/projectListLayout.ts`) so the half row cues that it scrolls. |
| An open project has its own URL: `/project/<id>` | The workspace UI is rendered by the `(app)` route group's **layout** (`components/Workspace.tsx`), with `/` and `/project/[id]` as empty pages, so it's one instance across both — a page-per-route would remount it on every URL change (e.g. autosave giving a new project its first id) and close the chat popup mid-conversation. The URL and the store's `currentProjectId` follow each other by one rule (`lib/projectRoute.ts`, pure and tested, including a simulation that they settle rather than ping-pong): whichever changed since the last decision leads; a deep link wins at load; a first save `replace`s the URL, switching projects `push`es (Back returns to the previous project). A link that can't load (deleted, someone else's, malformed) shows "Project not found" and leaves the open project alone. A deep link followed while signed out survives login: middleware adds `?next=<path>` to the `/login` redirect, the Google flow pushes there, and the magic-link flow carries it in a short-lived cookie (not a query param on the redirect URL — Supabase only honours redirect URLs matching its allow-list, so an extra query string could silently fall back to the site root) that `/auth/callback` reads. `next` comes from a URL/cookie and is redirected to, so every reader goes through `lib/nextPath.ts`'s `safeNextPath` (same-origin path only: rejects `//host`, backslashes, control chars, the login/auth/api paths, and anything that resolves off-origin) and the redirect is always built as `origin + path`. `openProject`/`hydrateFromStorage` resolve `opened | not-found | superseded` so an open that merely lost a race to another click never shows "Project not found". |
| Every AI call is tracked (opt-in via `SUPABASE_SERVICE_ROLE_KEY`) | `runStructuredCall` emits an `AiCallRecord` per API request (retries included) through an `onCall` option; the web app's routes record it server-side into `ai_calls` (metrics + cost, kept) and `ai_call_payloads` (full prompt/response, purged after 30 days), keyed by a client-minted `actionId` that each version also stores, plus a client-reported `ai_action_outcomes` for responses paid for but never shown. Tokens are the source of truth; cost is derived and stamped with a price version, and is `null` for a model with no configured price rather than a guess. Writes are server-only (service role, no RLS write policies); tracking failing never fails an AI call. An operator-only dashboard at `/admin/usage` (allow-listed by `ADMIN_EMAILS`, fail-closed, 404 for everyone else) reads it all through one SQL function. See `apps/web/README.md` and `apps/web/db/ai-usage.sql`. |
| `reworkModel`'s prompt warns against every validation-failure class strict mode can't prevent | Strict mode's constrained decoding guarantees the JSON *shape* is valid; the only failures a repair-retry can still hit are Zod's own semantic checks (duplicate id, edge to a nonexistent id, a cycle, a placeholder rationale) — each one costs a full extra billed call (the whole invalid output gets re-sent as input). `schema.ts`'s `STRUCTURAL_SELF_CHECK` names all four and is interpolated into `REWORK_PROMPT`, which — unlike `fromProse`'s prompt — hadn't warned against the first two; rework edits an existing graph, which is exactly where a removed component's edge is left dangling or an id gets reused by accident. Verified live via the read-only Supabase MCP connection: a real Re-simulate cost 3 rework attempts (2 of them retries) hitting exactly these two classes — a literal `"placeholder"` rationale and edges to ids not in the AI's own output. The first prompt fix alone didn't help; the retry rate held, and a second retry reproduced the identical `"placeholder"` text on the identical field. Root cause: `fromProse`/`extendedComponents`/the new checklist all spelled out the exact banned word ("placeholder") as the negative example, and the validator's own repair-retry message doubled it (`"placeholder" is a placeholder, not a reason`) — a known LLM priming failure mode, not a schema gap. Fixed by rewriting every prompt AND the validator's own error messages to describe the category without repeating the literal banned token (still confirms the model's bad value verbatim for debuggability, just not paired with the same word as the category label). Not yet re-verified after this second fix — check `ai_label_stats.retry_pct` for `reworkModel`/`reviseExtendedComponents` after the next few Re-simulates. |
| Cost work is driven by the usage dashboard's numbers, not guesses | With ~$0.81 of real usage logged: 54% of all spend was Re-simulate, and 48% of THAT was failed attempts (every retry was in Re-simulate; builds, findings and chat never retried). After the base-view / extended-edges fixes the first live Re-simulate needed zero retries — one sample, worth re-checking. A clean Re-simulate's floor is output tokens (~60% of its cost: the rework re-writes the whole model, mostly per-trait rationale prose), so the rework/build/extended prompts now ask for one short rationale of roughly 8 to 15 words — kept above the validator's 10-character minimum so brevity can't itself cause a retry; measure the effect in the dashboard's "Avg out tok" per step. Prompt caching is not a lever here (Re-simulates are further apart than the 5-minute cache, so it costs ~0.2 cents/call in write premium for almost no reads). The dashboard now shows the retry bill directly: a "Wasted on failed attempts" KPI, a per-day chart with the wasted share inside each bar, and a Wasted column per step (needs `db/ai-usage.sql` re-run; the page degrades to "—" until then). |
| Instance counts are set by Re-simulate, never reported as a finding | "Single instance / needs more instances / no replicas" was by far the most common finding, and acting on it (queue the fix, Re-simulate) spent a full billed call to flip one trait. `identifyFailures` is now told instance counts are not findings (and no longer offers `SINGLE_POINT_OF_FAILURE` as a code to reach for — the earlier priming lesson applies to codes too), and `dropInstanceCountFindings` removes any that slip through, deterministically: matched on code and title only (never the explanation, where a finding about something else can mention instances), and only for kinds that HAVE an instance count (service, database, load-balancer) — "single point of failure" said of an external dependency is a different risk and stays. In its place `reworkModel`'s prompt makes instanceCount the rework's own job: at the current tier, raise a service to `multiple` / a database to `has-replicas` itself, with a rationale naming the scale, and leave it small while the scale is small. The extended-components step (which owns the load balancer, and was never shown the workload) now gets a one-line `describeScale` so it can size one too. Prompt-driven, not a hard rule: no threshold in code decides what scale "needs" more instances, so it's the model's judgement — if it proves inconsistent, a deterministic tier threshold is the next step. |
| The base rework call is never shown the extended components | Found live across four Re-simulates (Instagram twice, YouTube once, and the earlier one): shown the extended components (CDN, object storage, load balancer, scheduled job…) and told to leave them out while also preserving every edge, the model kept re-emitting them — as fake base-kind stand-ins filled with placeholder text (where the recurring `"placeholder"` rationale actually came from; my earlier "the prompt primes it" theory was incomplete), or as edges to ids missing from its output — and every mistake was a full billed retry re-sending the whole model (about two thirds of a rework's cost in the YouTube run). `reworkModel.ts`'s `baseView` now removes them and their edges from the base call's input (a note names them by kind and label, never id), and `stripExtendedReferences` (via a new `normalizeOutput` hook on `runStructuredCall`, applied before Zod) drops any reference that still arrives through the user's own queued text. The same run showed the revise step had never been shown the existing edges, so it re-invented the wiring — a background job and a CDN ended up with no incoming edge, which the canvas draws as user traffic flowing straight into them. It now receives the original edges touching the extended components, and `checkNoDroppedExtendedEdges` (a `validateResult`, same mechanism as the base check) rejects a result that drops or reverses one. Known limit: both continuity checks treat any dropped edge between two kept components as an error, so a request to remove a connection WITHOUT removing a component would fail its retries; removing a component is exempt, which covers the normal cases. |
| Rework keeps the connection, not the literal edge; and says only what it changed | Found on the Zoom project (see the usage dashboard): the input had one edge listed twice, the user chose "insert a queue between A and B", the AI did exactly that, and `checkNoDroppedEdges` rejected it (a $0.02 retry) — then the retry kept the direct edge too, leaving two competing paths. The check now compares unique pairs and accepts a path through an inserted component; edges are deduplicated on input and output. The same project showed the first scale-up switching on rate limiting, breakers and stampede protection unasked (leaving the review nothing to find) and provenance drifting to "stated" for values nobody stated. `reconcileWithPrevious` (a `normalizeOutput` step) now restores unchanged traits' provenance/rationale, caps changed ones at "inferred", and reverts a `has…` protection flipped on when no fix or chat change was queued. `identifyFailures` drops findings whose code names another kind's trait (`LB_*` on a gateway). The dashboard says what a clean review means and to raise the scale next. |
| Shape problems are linted in code, beside the AI review | An independent Opus review of the Zoom project pointed out that the double path (a service reaching another directly AND through a queue) is visible in the edges alone, yet the AI review returned nothing. `lintTopology.ts` now adds deterministic findings to `identifyFailures`' result (same shape, with a fix Re-simulate can implement): `PARALLEL_SYNC_AND_ASYNC_PATH`, `QUEUE_NO_CONSUMER`, `QUEUE_NO_PRODUCER`. Deliberately few rules — only ones unambiguous from the graph. Not done, and worth a separate design: a client/actor node so edge direction means "initiator → callee" (the CDN and TURN wiring are wrong without one). |
| Scale moves one rung per Re-simulate | The tier ladders step ~100x, and on the Zoom project 100 → 1M in one go let a single Re-simulate switch on every protection, so nothing ever broke and the review had nothing left to find. The Controls now disable tiers more than one rung above the last simulated tier (`lib/workloadTiers.ts`; tooltip says to Re-simulate first), and `setWorkloadTier` clamps as a backstop. Lowering is always allowed; no baseline (legacy project) means no restriction. Trade-off: reaching a stated 1M target from 100 now takes two Re-simulates (~$0.04–0.09 each). |
| Build names the defining data path | The Zoom build had no media tier — the thing the product is — because a generic Meeting Service absorbed it. `SYSTEM_PROMPT` now asks for whatever moves the system's main payload to be its own service. Verified live on one Zoom-like and one URL-shortener description: the Zoom build gained media, chat, screenshare, recording and livestream services (10 components), the shortener stayed at 5 with no extra component. Two builds, so a sample of two. |
| A CDN's edge is oriented in code, not by prompt | Clients reach a CDN and it pulls from its origin, so the edge is `cdn -> origin`. The prompt line alone did nothing: a live Zoom-like build still drew `livestream-service -> livestream-cdn`. `sanitizeExtendedResponse` now turns any edge into a CDN around (on build and Re-simulate, so an older project heals on its next Re-simulate), and the lint rule `CDN_BEHIND_ORIGIN` flags one in a project that hasn't been re-simulated. The canvas's Traffic node feeds every component with no incoming edge, so the CDN now shows as a second entry point beside the gateway — not yet looked at in a browser. TURN/STUN stays wired from the service (see plans/PLAN-edge-direction.md). |
| A project's id and name are never the AI's to change | A Search-engine project's title became the literal text `{"value":"Google Search Engine (Core Request Path)"}`: a Re-simulate returned the name wrapped like a trait (once the `id` held a dump of the whole model), it is a valid string so nothing rejected it, and every later rework copied it forward. `reworkModel` now takes `id`/`name` from its (cleaned) input and overwrites whatever the AI returned; `fromProse` cleans its own; `unwrapIdentityText`/`cleanModelIdentity` (types.ts) unwrap the known shapes; and `loadProject`/`listProjects` heal already-saved projects as they are read (the next save writes the clean name back, no migration). The extended step's dropped-edge check got the same connection-not-literal-edge relaxation as the base one: on that project it rejected the queue-inserting fix (a retry) and the retry kept both paths. `identifyFailures` is also told to judge risks at the CURRENT scale (a 100-user system was getting critical "at scale" findings). |
| The minimum reliable flow is build + chat-requested change, checked by a scripted live eval | Goal stated by the product owner: a reliable baseline that others then refine through the AI chat, so build and "chat request → Re-simulate applies it" matter most. A throwaway script (six systems: build, one chat change each — add CDN, insert queue, rate-limit, remove cache, add service, split service — then Re-simulate) checks invariants: unique ids, no dangling/duplicate edges, clean name, no lint findings, no unrequested protection flipped, no unasked id loss, requested effect present. Findings from two runs: 0 failed attempts on nearly all calls and the requested effect present every time it was well-posed, but (1) two of three video builds wired a direct edge AND a broker path (base and extended calls disagree) → `collapseParallelAsyncPaths` now keeps the buffered path and drops duplicate edges on every build and Re-simulate; (2) chat queued no-op changes ("remove the cache" when none exists; "add a queue" when one does) → the route prompt checks for already-true/impossible first, and a reply that ends in a question is never queued (code). Remaining variance: an ambiguous request gets an inconsistent restatement (once it invented an edge to delete). The script is now checked in as `packages/engine/scripts/eval-live.ts` (`npm run eval:live`, costs money, exits non-zero on a broken invariant). A later pass on eight scenarios was 8/8 clean with 2–3 retries, each traced and fixed in code: workload targets are snapped to the ladder (`snapToLadder`); an edge to an id the user's own request names but the base call can't emit is dropped (`dropEdgesToMentionedUnknowns`); a request the extended step owns skips the base-only edge check and lost connections are restored on the merged graph (`restoreDroppedConnections`); extended components get the same provenance/protection reconciliation as base ones. Re-verified live afterwards: two runs of the eight small scenarios had 0 retries (one scenario each run missed once: an unqueued-consumer queue, and an object-storage request that never produced storage). Five LARGE systems (Netflix, Uber, Amazon, Twitter, Slack-like; `EVAL_SET=large`) were 5/5 clean with 0 retries, 12–16 components (the 15-component cap is hit, by design), $0.06–0.08 each for build + chat + Re-simulate (findings not included). The eval prints cost per scenario. The chat restatement was inventing kinds (`storage`, `message-queue`), so the route prompt now lists the valid ones. |
| Two review-noise filters, from one large end-to-end live run | A single Netflix-like system (build → findings → 4 chat messages → Re-simulate with two queued changes and a chosen fix → findings → 10K-user scale step) cost $0.24 with no retries. Two things kept the findings from teaching well: the chosen fix "integrate a secondary payment processor" added `payment-processor-secondary`, which the next review flagged for having no fallback (a standby IS the fallback), so fixes never converged; and "…_AT_SCALE" findings appeared on a 100-user system (2 of 3 real projects). `dropStandbyFallbackFindings` and `dropAtScaleFindingsWhenSmall` (identifyFailures.ts) remove them in code, plus a prompt line each. Checked live afterwards ($0.23, raw AI findings compared with what is kept): on four reviews of three systems at the bottom rung the filter dropped 5 findings, all warnings, 4 of them `UNCACHED_DATABASE_AT_SCALE` and 1 `FIXED_SCALING_AT_SCALE`, and the same `UNCACHED_DATABASE_AT_SCALE` came back, kept, when the same system was reviewed at 10K users (0 dropped there). The standby filter did NOT fire in that run (the situation didn't recur: with the secondary provider added, the model raised no fallback finding at all), so it is unit-tested only. Also seen and left alone: `SINGLE_POINT_OF_FAILURE@gateway` still gets through at 100 users (a gateway has no instance-count trait). Not changed: the 10K-user Re-simulate made no trait changes — unclear whether instance counts were already `multiple` or the auto-set rule didn't fire; a code threshold (services multiple from 10K users, database replicas from 1M) is the fallback but is a product decision. |
| A schema-valid rework result can still be substantively wrong — code now catches it | Confirmed live via the Instagram-project comparison: a first attempt catastrophically malformed its tool call, and the repair-retry "fixed" it by patching only the two reported Zod errors onto that broken skeleton — schema-valid, but missing 8 of 9 edges and the entire requested feature, and nothing caught it before it shipped as the new version. `runStructuredCall` (`structuredCall.ts`) now takes an optional `validateResult` hook, run after Zod validation succeeds, for an invariant Zod structurally cannot check (it never sees the ORIGINAL input, only the proposed output). `reworkModel.ts`'s `checkNoDroppedEdges` enforces, in code, the continuity rule its own prompt already stated but didn't enforce: an edge between two components the result kept must still be present, unless the request asked for its removal. A violation is billed and repaired exactly like a Zod failure (same retry loop, same usage-tracking `outcome: "invalid"`), not a separate path. Scoped to `reworkModel` only for now — `reviseExtendedComponents` isn't covered, since the evidence pointed at the base call specifically. |
| Credits, not subscription | Usage is bursty and low-frequency; subscription fights the pattern. |

## Current state

The app is a working, full-loop product, not a prototype: describe a system
in prose, get a diagram with AI-identified findings and fixes, apply fixes
or chat free-form to queue changes to it, Re-simulate to apply everything queued, save/reopen
multiple projects across sessions. 472 tests passing (203 engine + 269 web),
typecheck clean across both workspaces, pushed to `origin/main`.

**Auth + persistence.** Magic-link email and Google login (client-side
Google Identity Services, not a redirect through Supabase's own domain —
deliberately chosen so the consent screen shows this app's real origin),
gated by `apps/web/middleware.ts`. Every project is a row in a Postgres
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

**Findings are AI-generated**, not pattern-matched — see the section above
for the full history of that decision. `identifyFailures.ts` is the sole
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
final form, and "Findings are AI-generated" above for why it was safe to
remove rather than extend for the newer component kinds it never gained
pattern logic for.

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
