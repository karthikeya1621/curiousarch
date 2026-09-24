# archsim

Headless architecture-modelling engine. No React, no DOM.

```bash
npm install
npm test          # 142 tests
npm run typecheck
```

## What this is

The headless engine only. It turns a prose description of a distributed
system into a rough architectural model — components tagged with a handful
of categorical traits, never a number — and identifies which real
architectural risks that model has, with the reasoning behind each one.

## Design rules that are load-bearing

**Findings are AI-generated, not pattern-matched.** `inference/
identifyFailures.ts` is the web app's only source of findings: one free-form
AI call given the current model as context, asked to reason like a senior
architect and name real risks with evidence pointing at specific traits.
This package used to instead run a hand-written deterministic pattern
catalogue (`patterns.ts`/`solver.ts`/`whatif.ts`/`fixes.ts`, since deleted —
see git history for their final form) and treated "findings are computed,
never generated" as non-negotiable, precisely because an earlier LLM
(Gemini, shown a screenshot of this app's own output) produced a fluent but
fabricated causal story when asked to explain a failure with no computed
evidence behind it — see `CONTEXT.md`'s "Why the pivot" for the full
incident. The explicit, informed decision behind `identifyFailures.ts` was
to accept that risk anyway — "fully AI-generated, no need verification...
it should think how a human senior architect thinks" — rather than keep
maintaining a second, hand-written catalogue that always lagged behind
what the AI-driven model could actually represent (most visibly: seven
component kinds it never gained pattern logic for, listed below).

**Every trait carries provenance.** `Trait<T>` records whether a value was
stated by the user, inferred from prose, or defaulted, plus a one-line
rationale that can't be a throwaway placeholder (`traitSchema`'s own
`.refine()` rejects "n/a", "invalid", and the like — see `schema.ts`). Prose-
derived modelling means the model is guessing categories (does this have a
replica? is the TTL short?), and the correction loop only works if the UI
can show what was guessed and let the user overwrite it.

**Twelve component kinds, two structured calls.** Five base kinds (gateway,
service, cache, database, queue) come from the main topology call
(`fromProse.ts`/`reworkModel.ts`, via `inference/schema.ts`'s
`SystemModelSchema`). Seven more (external dependency, load balancer,
message broker, CDN, object storage, scheduled job, config store) come from
a genuinely separate call (`inference/extendedComponents.ts`), merged into
the final model in code. They're split across two calls, not one schema,
because `SystemModelSchema` was already documented as sitting right at
Anthropic's strict-mode compiled-grammar size limit before the seven
existed — see `workloadParameters.ts`'s own comment for how that was
discovered live.

**Component/description size is capped before generation, not after.**
`MAX_BASE_COMPONENTS`, `MAX_EXTENDED_COMPONENTS`, `MAX_TOTAL_COMPONENTS`
(`types.ts`) are enforced at the schema level (`superRefine` rejection,
triggering a repair retry) and again defensively in code
(`extendedComponents.ts`'s `sanitizeExtendedResponse`), on top of prompt-
level guidance and a dynamic per-call remaining-budget line. This is a
guardrail against runaway cost/size, not a product decision about what a
"good" system diagram looks like.

## Why there are no numbers

An earlier version of this engine simulated M/M/c queueing math over
inferred magnitudes (`queryTimeMs: 25`, `connectionPoolSize: 240`). It
worked, and its math was correct, but the numbers feeding that math were
guesses an LLM had no way to actually verify from a prose description, and
precise math on top of a guessed number produces a confident,
specific-sounding **wrong** answer. That's worse than an honest rough one.
The full account, including a live demonstration of exactly this failure
mode, is in the repo root's `CONTEXT.md` under "Why the pivot." The short
version: "does this have a read replica" is a question a sentence can
actually answer; "what's the query time in milliseconds" never was.

## Modelling assumptions, stated plainly

Every component kind carries 1-3 rough traits, deliberately not more — see
`types.ts`. This is a scope decision: the model only needs enough signal for
an AI reviewing it to name a real risk, not a full configuration surface. If
a new trait is needed, add it to the specific kind(s) it applies to and
update `inference/schema.ts` and `inference/prompt.ts` together (or
`inference/extendedComponents.ts` for one of the seven extended kinds).

## Structure

```
src/types.ts                        Trait<T>, Component/SystemModel, isTrait, guardrail constants
src/components.ts                   isAsyncBoundary (a queue is where a sync chain stops)
src/inference/schema.ts             Zod schema an LLM fills for the 5 base kinds; every trait is a boolean or small enum
src/inference/prompt.ts             The base-topology system prompt, kept separate so it can be diffed
src/inference/extendedComponents.ts The 7 extended kinds: a genuinely separate structured call, propose + revise
src/inference/fromProse.ts          Prose -> SystemModel: topology + workload params (parallel) + extended components (sequential)
src/inference/reworkModel.ts        "Re-simulate": reworks the base topology, then revises extended components to match
src/inference/workloadParameters.ts Extracts workload.users/requests; always starts at the lowest tier regardless of stated scale
src/inference/identifyFailures.ts   The web app's only findings source: one free-form AI call given the model
src/inference/explainFix.ts         One sentence of AI narration for why a fix fits this specific system
src/inference/chatWithProject.ts    Free-text chat about the current project — answers questions, or turns a change request into a queueable instruction (applied later by reworkModel)
src/inference/structuredCall.ts     Shared tool-use + Zod validation + one repair retry core, used by every call above. Its `onCall` option receives one `AiCallRecord` (prompt, response, tokens, request id, outcome, timing) per API request, retries included — how the web app tracks usage without this package knowing about a database
models/reference.ts                 Three hand-modelled systems, reused across the test suite as realistic fixtures
tests/                              Schema tests, tool-schema tests, one test file per inference module
docs/inference-log.md               Historical: the numeric engine's PLAN-0.4 comparison runs
```

The engine takes a model and returns results. It imports nothing from the
app.
