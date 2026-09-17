**Historical record — read as an account of what happened, not of the
current engine.** The "Reframing" section below (what-if over forecasting)
was the first step away from numeric forecasting; a later pivot went
further and replaced the numeric queueing engine itself with a categorical
pattern-matching one (no `serviceTimeMs`/`queryTimeMs`/rps anywhere anymore).
See the repo root `CONTEXT.md`'s "Why the pivot" section and
`packages/engine/README.md`'s "Why there are no numbers here" for the
current architecture and why this document's own findings motivated it.

# PLAN-0.md — Prove the core

**Goal, reframed after 0.4's result:** the original goal — does prose-derived
modelling produce *absolute* numbers (this query takes 15ms, this system
breaks at 66,667 rps) an experienced engineer won't dismiss — is answered, and
the answer is no (see 0.4, Kill criteria). That doesn't kill the product; it
kills forecasting as the interaction. The reframed goal: does the engine's
*relative* response to a what-if perturbation — starting from whatever a user
actually stated, defaults filling the rest — say something an experienced
engineer recognizes as true? See "Reframing: what-if over forecasting" below
the Kill criteria section for the full reasoning and what it changes.

**Do not start Phase 1 until this is answered.** Everything downstream assumes
it. No UI work in this phase — a CLI is enough to learn what needs learning, and
it gets there in days rather than weeks.

---

## Done

- [x] `src/queueing.ts` — Erlang B/C, M/M/c, response quantiles, Little's Law
- [x] `src/components.ts` — capacity models for service, cache, database, queue
- [x] `src/solver.ts` — load propagation, critical path, findings, breaking point
- [x] `models/reference.ts` — three hand-modelled systems
- [x] 35 tests passing, typecheck clean

Three bugs caught by the golden tests are recorded in CONTEXT.md. The pattern
worth keeping: the engine is wrong until it reproduces the hand-model.

---

## 0.1 — Inference schema ✅

Define the Zod schema the LLM fills. It mirrors `SystemModel` exactly, so the
structured output *is* the model rather than something that needs translating.

- Schema in `src/inference/schema.ts`, derived from the types in `src/types.ts`.
- Every parameter field requires `provenance` and `rationale`. Force the model
  to say why it chose 8ms; a value without a reason is unreviewable.
- Put reasoning fields *before* value fields in the schema. Field order affects
  quality with constrained decoding — conclusions before reasoning degrade it.
- Reject models with cycles at parse time rather than letting the solver throw.

**Acceptance:** a hand-written JSON fixture round-trips through the schema into
a `SystemModel` that `simulate()` accepts. Done in `tests/schema.test.ts`, plus
tests for an invented component kind, a cycle, a missing rationale, and a
dangling edge reference — all rejected at parse time.

## 0.2 — Prose to model ✅ (code) / ⏳ (acceptance)

A single function: prose in, `SystemModel` out. One LLM call, structured output,
Zod validation, one repair retry on validation failure.

- `src/inference/fromProse.ts`. Tool-use structured output against
  `SystemModelSchema` converted to JSON Schema via `zod-to-json-schema`, so the
  tool definition can't drift from the validation schema. One repair retry,
  feeding the validation error back to the model, per spec.
- Prompt states the component vocabulary explicitly in `src/inference/prompt.ts`,
  kept separate so it can be diffed as 0.4 surfaces bias.

**Acceptance:** three prose descriptions of the reference systems produce models
that simulate without throwing. **Not yet run against a live model** — the
available key has no credit balance (confirmed: request reaches the API and
gets a real 400 on billing, not a wiring bug). The retry/validation state
machine around the LLM call — repair-on-failure, "model didn't call the tool"
handling, give-up-and-throw, the API-key check — is verified against a mocked
client in `tests/fromProse.test.ts` (6 tests, no network). **Now confirmed
live** — runs 5–7 in `docs/inference-log.md` went through the real pipeline
successfully. Getting there required fixing four real bugs in the tool-schema
generation (wrong JSON Schema target, unsupported strict-mode keywords, a
grammar-size blowup from inlining a repeated sub-schema, and no `strict: true`
at all initially) — all now covered by `tests/toolSchema.test.ts` so they
can't silently regress. Whether the model's inferred *parameters* are any
good is a separate question — see 0.4.

## 0.3 — CLI harness ✅

```
npx tsx bin/sim.ts "describe a system..."
npx tsx bin/sim.ts --model url-shortener --rps 50000
```

Prints the inferred model with provenance marks, the breaking point, and every
finding with its evidence. No formatting effort beyond readability.

**Acceptance:** you can run a system description and read the verdict in under
ten seconds. Verified against all three reference models via `--model`; the
prose path is implemented identically but untested end-to-end (see 0.2).

## 0.4 — The comparison ✅ 10/10 runs done — forecasting ruled out, engine cleared (see Reframing below)

The actual work of this phase.

Write prose descriptions of the three reference systems at the level of detail a
real user would give — a paragraph, not a spec. Run inference. Compare against
`models/reference.ts` on:

| What | Passes if |
|---|---|
| Topology | Same components, same edges, cache/queue placed correctly |
| Bottleneck identity | Names the same component as the first to break |
| Breaking point | Within 2x of the hand-model |
| Parameters | Service times within an order of magnitude, pool sizes sensible |

Record every run in `docs/inference-log.md` — prose, inferred parameters,
hand-model value, verdict. Ten runs minimum. You are looking for systematic bias
(does it always guess 10ms? does it always assume a cache?), not one-off misses.

**Acceptance:** bottleneck identity correct in at least 8 of 10, breaking point
within 2x in at least 7 of 10.

**Result: 3/10 (30%) and 2/10 (20%, both coincidental) — both fail the bar.**
Interpretation and what was ruled out along the way: see Kill criteria below.
Full detail — all 10 prose descriptions, raw outputs, per-run analysis — in
`docs/inference-log.md`.

## 0.5 — Your own system ⏳ blocked on you, by design

**Lighter than originally scoped, per the reframing below.** You don't need to
supply or verify every duration and capacity number for a system you've
operated — just the facts you actually know (traffic level, topology,
instance/pool counts, whatever's real to you). Everything else defaults the
way it already does. The test is no longer "did the tool forecast my exact
p99" — it's "starting from what I actually told it, do the what-if scenarios
say something true about my system."

Describe it, I build the baseline, then we run a few what-if scenarios
against it (`bin/whatif.ts`'s catalogue, or a bespoke one if the failure mode
you care about isn't in it) and you judge the deltas, not the absolute
numbers.

**Acceptance:** at least one what-if delta tells you something true about how
your system would actually behave. If it tells you something you already
knew, that's fine — Phase 1 adds the value on top. If a delta's *direction* is
one you know to be wrong (a scenario that should clearly make things worse
doesn't, or vice versa), that's the signal worth taking seriously — it would
mean the engine's mechanism, not just an absolute number, is unsound.

---

## Kill criteria

Stop and rethink if any of these hold after 0.5:

- The wrong component is named as bottleneck on systems you know.
- Breaking points are off by more than an order of magnitude.
- Inference is unstable — the same prose yields materially different models
  across runs.
- Parameters are consistently optimistic in a way that hides real failures.
  Optimistic and wrong is worse than useless; it is harmful.

**Status after all 10 planned runs (see `docs/inference-log.md`): the first
criterion is triggered.** *(This sounds like a kill — it isn't quite one; see
"Reframing" below before drawing that conclusion.)* Bottleneck identity
correct in only 3/10 (30%), against an 80% bar. This held after fixing every
plausible confound:

- Four implementation bugs in the tool-use schema (0.2) — fixed, tested,
  confirmed live.
- Two prompt gaps, each found on 3+ independent systems, each verified fixed
  on two systems after patching `prompt.ts` (runs 9, 10 vs. 5, 8) — gateway
  ceilings guessed near current traffic, and a cache's downstream edge
  double-applying its own hit rate.
- A real, independent engine bug (cache capacity silently masked as healthy)
  found and fixed along the way — see CONTEXT.md. Not an inference-quality
  issue, but worth naming: the golden tests had been passing over it the
  whole time, because none of them checked a cache's own utilization.

After all of that, the failure is unchanged in *kind*: every wrong bottleneck
traces to a guessed duration or capacity number (`serviceTimeMs`,
`queryTimeMs`, `consumerServiceTimeMs`, `replicaApplyRate`, and — reproduced
immediately, with zero prior prompt engineering — the brand-new `cpuTimeMs`)
for something the prose described only qualitatively. Never a topology
mistake, never a misread stated fact, across all 10 runs. The direction isn't
consistently optimistic (run 5 guessed a service *faster* than real; runs 3,
6, 9 guessed things *slower*) — so the "consistently optimistic" criterion
doesn't quite fire — but "off by 5-8x in either direction on anything not
explicitly stated" is functionally the same problem the criteria exist to
catch.

**Still not fully conclusive, and by design:** 8 of the 10 runs compare
against the three original hand-models (real operational judgment) or a
system I invented myself (runs 8, 10 — useful for topology/edge-case
coverage, but the "hand-model" there is just my own assumption, not verified
truth — see the run 8/10 caveat in the log). **0.5 is what settles whether
"off by 5-8x" is as damaging in practice as it looks here.** That is the one
run this document cannot substitute for.

**Superseded by the reframing below** — kept for the record, not deleted,
because it's still the right fallback *if* the product ever needs absolute
forecasts again: ask three or four pointed questions before the first run
(query times, read/write mix, instance count) and infer only the rest. Every
failure across all 10 runs was a duration/capacity guess — exactly what this
would remove from the model's job. The reframing below is a cheaper way to
the same place: stop asking the model to guess those numbers *at all*, and
stop needing them to be right.

## Reframing: what-if over forecasting

The result above rules out forecasting as the interaction — it does not rule
out the engine, and it doesn't require solving the guessing problem. It
reframes what the guesses are for. `src/whatif.ts` (built the same session
0.4's result came in) is that reframing in code: given a baseline model —
however it was built, stated facts plus whatever defaults fill the rest —
ask a relative question instead of an absolute one. "What happens to *this*
model if traffic triples" only needs the queueing math to be sound, which
the golden tests (and now `tests/cacheCapacity.test.ts`, found the same way
this reframing was) hold to a real, hand-derived standard. It does not need
`serviceTimeMs` to be within 2x of some true value nobody stated, because the
answer is a *comparison of the model against itself*, not a claim about the
real system's absolute numbers.

**What this changes, concretely:**

- **The bar for a baseline model** drops from "forecasts correctly" to
  "captures what was actually stated, without inventing a specific,
  consequential number the prose gave no basis for" (the gateway-ceiling and
  cache-edge bugs found and fixed in 0.4 are exactly this second failure
  mode — worth continuing to fix, distinct from duration-guessing).
- **0.5's job** shrinks from "verify absolute forecasts against ground truth"
  to "confirm the what-if deltas match your own operational intuition." See
  0.5 above.
- **The kill criteria above still matter, reinterpreted:** "wrong bottleneck
  named" is a real problem for the *baseline* health check shown before any
  scenario is applied (someone reading "you're healthy" when they're not is
  still a plausible-looking lie) but is no longer the test the whole product
  lives or dies on — the what-if deltas are. "Inference is unstable" and
  "consistently optimistic" still apply exactly as written; nothing about the
  reframing touches the parts of 0.4's result that were about the *process*
  of inference rather than the accuracy of one forecast.
- **What would still kill this:** a what-if scenario whose *direction* is
  wrong — reports improvement where the real system would degrade, or vice
  versa — since that implicates the engine's mechanism, not an absolute
  number nobody claimed to know. That's the thing 0.5 is actually checking
  for now.

## Notes

- Do not improve the prompt by testing against the same three systems repeatedly.
  You will overfit to them. Keep two descriptions held out.
- Do not let a model grade its own inference. The failure mode is a confident
  8ms guess for an 80ms query, and a grader with the same priors agrees with it.
- Resist adding component kinds here. Four is enough to answer the question.
