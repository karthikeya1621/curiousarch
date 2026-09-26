# Product decisions and principles

> Part of the project context; the index is [`CONTEXT.md`](../../CONTEXT.md). The foundational product and technology choices (categorical traits, the tier ladder, no drag-and-drop, the rendering stack), the principle that judgment belongs to the AI while code only enforces validity, and pricing. Read before proposing a change of direction.

Each section below is one decision: the heading is the decision, the text is the reason and the evidence. A decision marked ~~struck through~~ or "superseded" is kept on purpose, so the reasoning is not lost.

## Categorical traits, not numeric parameters

See "Why the pivot" in [`history-and-pivot.md`](history-and-pivot.md). An LLM can reliably answer "does this have a replica" from a sentence; it cannot reliably answer "what's the query time in ms," and precise math on top of the latter produces a confidently wrong answer, demonstrated live by the Gemini incident. Don't propose bringing numeric simulation back without new evidence this is actually solved — it isn't a tuning problem.

## Workload is a rough tier ladder, not a raw number

**Updated, decision itself unchanged**: no longer the four-rung Small/Medium/Large/Massive `ScaleTier` (deleted along with the pattern engine that read it) — now `users`/`requests`, each a closed ladder (100/10k/1M/100M; 1k/100k/10M/1B) the AI snaps a stated target to. Still never a number the AI computes or the UI lets you type free-form; still starts at the lowest rung regardless of what the description states (see `workloadParameters.ts`).

## ~~Six patterns in v1, not fifty~~ — superseded

The pattern catalogue this row defended no longer exists (see "Findings are AI-generated" in [`history-and-pivot.md`](history-and-pivot.md)). The underlying instinct — don't pad coverage for a round number, only add something for a real, checkable piece of wisdom — still applies to `identifyFailures.ts`'s prompt, which explicitly lists a small set of example risk categories rather than an exhaustive taxonomy.

## TypeScript engine, not Rust/Wasm

Tens of components, one or two AI calls per interaction — trivially fast regardless of language. Engine is isolated so it can be swapped if profiling ever says otherwise (it won't need to).

## No drag-and-drop

The crowded lane. SysSimulator and ~8 others already do canvas + simulation, free.

## React Flow for rendering

Still needed for nodes/edges/click targets. Layout is programmatic (ELK).

## ELK.js with pinned node identity

Must animate, not repaint. Regeneration is frequent here, so instability is worse than in a drag tool.

## Judgment lives in the AI; code enforces validity

Product owner: "it is slowly becoming hardcoding instead of AI reasoning" (and earlier: instance counts "should be set by AI based on the tier groups"). Audit of what had crept into code: string matching on natural language (regexes over finding codes/titles, a keyword list for "keep direct", another for "extended request", "reply ends in ?", a name match for standbys). Converted so the AI decides and code only reads: the findings schema has `bitesAt` ("now"/"larger-scale") and `aboutInstanceCount`, filled by the AI per finding, and the at-scale and instance-count filters read those fields; the chat route has `needsClarification`; the base dropped-edge check stands down whenever anything is queued (structural, not a regex on the request) with `restoreDroppedConnections` repairing the merged graph; load-balancer routing applies only to a balancer new in the result; the standby-name filter was removed outright (its prompt line stays). What stays in code is structural validity (dangling/duplicate edges, cycles, corrupted identity, lost connections, snapping to the ladder, provenance honesty) plus `startMinimal` (enforcing the stated "start minimal at the lowest tier" principle) and the topology rewrites (queue/LB collapse, CDN orientation, LB routing), which are the next candidates: the intended replacement is one small merged-graph review call that sees both halves of the graph and the request and returns edge edits, validated in code — NOT built, because it must be judged live first. Risks of this change, unverified live: the two new required fields must be accepted by the strict findings tool schema, and the model must fill them sensibly (a finding it forgets to flag as instance-count now leaks through; the old regex net is gone).

## Credits, not subscription

Usage is bursty and low-frequency; subscription fights the pattern.
