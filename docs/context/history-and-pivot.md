# History and the numeric-to-categorical pivot

> Part of the project context; the index is [`CONTEXT.md`](../../CONTEXT.md). Read this before re-adding numbers to the model or before reviving a deterministic finding engine: it records why the numeric queueing engine was deleted, why findings became AI-generated, and what was deleted rather than archived.

## Findings are AI-generated — a later, deliberate reversal of this section's original claim

**Historical note, kept because the reasoning still matters:** this section
originally said findings were "computed by a deterministic pattern
catalogue, never asserted by an LLM" — `packages/engine/src/patterns.ts`,
built specifically because an external LLM (Gemini), shown a screenshot of
this app's own output and asked to explain why the system broke, produced a
fluent, specific-sounding, and **wrong** causal story: inventing a mechanism
("replication lag cascades into connection exhaustion") the engine never
computed, and misreading how connection pooling works along the way. That
incident is real and is preserved below, under "Why the pivot" — it's why
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
