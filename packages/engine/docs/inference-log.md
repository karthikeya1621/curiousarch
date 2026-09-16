# Inference log — PLAN-0.4

The comparison: prose descriptions run through inference, checked against
`models/reference.ts`'s hand-models. Ten runs minimum, two systems held out
and not iterated against (see PLAN-0.4's note on overfitting).

Acceptance: bottleneck identity correct in >= 8/10, breaking point within 2x
in >= 7/10.

## A methodology note on runs 1–4

These four runs were **not** made through `src/inference/fromProse.ts` — the
available `ANTHROPIC_API_KEY` has no credit balance (confirmed: a real 400
from the billing check, not a wiring bug). As a free substitute for the
substantive question — does prose-derived inference produce sane numbers? —
runs 1–4 used a fresh Claude subagent per run, instructed with the same
component vocabulary and output schema `fromProse` uses, given only the prose
below (never `models/reference.ts`, never this conversation). Its output was
then validated against `SystemModelSchema` and diffed against the hand-model
mechanically via `bin/check-inference.ts`. This tests inference quality, not
the tool-use wiring itself (that's covered separately by the mocked tests in
`tests/fromProse.test.ts`).

**Runs 5–7 below are through the real pipeline** — the key was funded after
run 4. They matter more than 1–4: they're the actual code path, not a proxy.

**Overfitting risk, disclosed:** after run 1 failed, the prompt given to runs
2–4 was revised inline (see run 2) to address the specific failure mode run 1
exposed, on one of the very three systems being measured. That is exactly the
overfitting PLAN-0.4 warns against. Run 2's improvement should not be read as
"the prompt is fixed" — only as "this specific failure mode is fixable," which
still needs confirming on genuinely new systems, not the same three. Notably,
that ad hoc prompt fix was never ported back into `src/inference/prompt.ts` —
runs 5–7 use the original, unrevised production prompt, which is exactly why
run 5 reproduces run 1's failure almost exactly (see below).

**A methodology bug, found and fixed:** the comparison scripts originally
declared "bottleneck match" by comparing the reference's and the inferred
model's `componentId` strings directly. Those are arbitrary — the inferred
model calls its queue `transcodeQueue`, the hand-model calls it `queue` — so a
string comparison reported a false FAIL on a component that was correctly
identified by *kind*. Fixed in `bin/check-inference.ts` and
`bin/run-comparison.ts` to compare by the component's `kind` instead. This
didn't change any verdict already written up by hand below (runs 1–4 were
assessed by reading the output, not by the buggy script), but it means the
per-run "bottleneck match" lines from run 5 onward are the first ones an
automated check actually produced correctly.

## Four real bugs found getting the live pipeline working

None of these are inference-quality findings — they're implementation bugs in
`src/inference/fromProse.ts` that blocked every live call until fixed. Each
is now covered by a test in `tests/toolSchema.test.ts` so it can't silently
regress:

1. **`zodToJsonSchema(..., { target: "openApi3" })` emits OpenAPI's boolean
   `exclusiveMinimum: true` + separate `minimum`, not JSON Schema draft
   2020-12's numeric `exclusiveMinimum: 0`.** The API rejected every call
   with a 400 before generation ever started. Fixed by switching to the
   `jsonSchema7` target.
2. **With `strict: true` (added to actually constrain the model's output
   after finding bug 4 below), the API rejects `exclusiveMinimum` entirely** —
   apparently unsupported by the constrained-decoding grammar regardless of
   form. Fixed by stripping all numeric bound keywords from the schema sent
   to the tool; the real bound (`.positive()`) is still enforced by
   `SystemModelSchema.safeParse()` on the response.
3. **Inlining the repeated `ParameterSchema` at all ~20 occurrences produced
   a schema whose compiled strict-mode grammar the API rejected as "too
   large."** Fixed by hoisting `ParameterSchema` into the JSON Schema
   `definitions` block via `zodToJsonSchema`'s `definitions` option, so it's
   defined once and `$ref`'d — cutting the schema by more than half.
   `$refStrategy: "root"` alone wasn't enough: without an explicit
   `definitions` map it pointed `$ref` at the first inline occurrence's own
   path (`#/properties/components/.../id`), which the API also rejects
   ("References must be defined under '$defs' or 'definitions'"). The same
   error then reappeared for the shared `id`/`label` fields, which were
   accidentally the same object instance across all five component schemas
   via a spread `BaseFields` object — fixed by making `baseFields()` a
   function that returns fresh instances, since that incidental sharing
   wasn't worth hoisting into `definitions` too.
4. **Without `strict: true`, the schema is only a hint, not a hard
   constraint** — observed live: the model wrapped its correct answer in a
   spurious outer key (`{"parameter name": {...}}`, then `{"model": {...}}`
   on the retry) instead of matching the tool schema's top level. Fixed by
   adding `strict: true` to the tool definition, which every object in
   `SystemModelSchema` already satisfied (`additionalProperties: false` +
   full `required`, Zod's default) without any schema changes.

All four were caught by an actual 400 or a real malformed response — none
were guessed and fixed speculatively. Every fix was verified offline against
`ajv`'s JSON Schema draft 2020-12 meta-schema before spending another call on
it, once the pattern of "guess, spend a call, learn" got expensive enough to
stop doing three times in a row.

Run with (once the key has credit):

```bash
ANTHROPIC_API_KEY=... npm run sim -- "<prose description>"
```

Compare a saved inferred JSON model against a reference system with:

```bash
npx tsx bin/check-inference.ts <inferred.json> <url-shortener|checkout|media-upload>
```

---

## Runs

### Run 1 — URL shortener (initial prompt)

**Prose:**

> We run a URL shortener. Traffic is around 10,000 requests per second, and
> the vast majority of that is redirects — someone clicks a short link and
> gets sent to the real URL. Creating new short links happens rarely by
> comparison. Redirects hit our API layer, which currently runs 20 instances
> behind a load balancer. In front of our Postgres database we run a Redis
> cache with a five-minute TTL; most of the traffic is for links that were
> shortened recently, so the cache should absorb a good chunk of it. Postgres
> has a connection pool capped at 100 connections and we don't run any read
> replicas.

**Hand-model:** bottleneck = `svc` (service, 66,667 rps — instances × concurrency
at 15ms/request). Full model in `models/reference.ts` (`urlShortener`).

**Inferred:** bottleneck = `gw` (gateway), breaking point 15,001 rps. Full
output in `docs/inference-runs/run-1-url-shortener-initial-prompt.json`.

**What went wrong:** the model invented a gateway `maxRps` of 15,000 — "sized
with headroom above current load" — where the prose stated no such ceiling at
all and the hand-model treats the gateway as effectively unconstrained
(100,000, "ALB default account ceiling"). That fabricated, conservative
ceiling became the active bottleneck, masking the real one. It also added an
extra `api -> db` edge alongside `cache -> db` with its own fractional
`callsPerRequest`, double-applying the cache miss ratio — a topology the
schema/prompt didn't rule out clearly enough.

**Verdict:** FAIL — wrong bottleneck, breaking point 4.4x low (0.23x).

---

### Run 2 — URL shortener (refined prompt)

Same prose as run 1. Prompt revised to (a) tell the model a gateway ceiling
near current traffic is an unusual specific fact that needs prose support, not
a default, and (b) clarify that a cache's `hitRate` already produces the
hit/miss split, so the edge to whatever is downstream should normally be 1.

**Hand-model:** bottleneck = `svc`, breaking point 66,667 rps.

**Inferred:** bottleneck = `gateway`, breaking point 50,001 rps. Full output in
`docs/inference-runs/run-2-url-shortener-refined-prompt.json`.

**What went wrong:** the topology fix worked — clean `gateway -> api -> redis
-> postgres` chain, no fabricated edges. But the model separately guessed
`serviceTimeMs = 2ms` for the redirect service against the hand-model's 15ms
("lookup plus 302 render") — 7.5x too fast — which inflated the service's
computed capacity to ~500,000 rps. Combined with a still-somewhat-conservative
default gateway ceiling (50,000), the *breaking point number* landed within
2x of the real one (0.75x) — but for the wrong reason: the reference's actual
bottleneck (the service) never saturates at all in the inferred model at any
realistic load below the gateway ceiling.

**Verdict:** FAIL on bottleneck identity (right number, wrong cause) — PASS on
the 2x breaking-point threshold, but see the note above on why that pass is
not reassuring here.

---

### Run 3 — Checkout / order placement

**Prose:**

> This is our checkout / order-placement service. It's currently doing about
> 500 requests per second. Each request goes through 8 instances of our order
> service, which validates the order and makes a synchronous call out to the
> payment provider before writing the order to Postgres. There's no cache in
> front of the database — almost all of this traffic is writes (placing new
> orders), not reads. Postgres connections are unpooled by any external
> pooler like PgBouncer and capped at 40 connections. We run two read
> replicas off the primary.

**Hand-model:** bottleneck = `db` via `REPLICATION_LAG` (writes outrunning
replica apply rate), breaking point 978 rps.

**Inferred:** bottleneck = `order-service` (plain saturation), breaking point
1,067 rps. Full output in `docs/inference-runs/run-3-checkout.json`.

**What went wrong:** topology and the stated parameters (8 instances, pool of
40, 2 replicas) matched exactly. But `serviceTimeMs` was guessed at 150ms
(validation + "typical" third-party payment latency) against the hand-model's
40ms, and `replicaApplyRate` was guessed at 2,000 ops/sec against 800 — both
guesses in the *same direction that hides the real failure*: an
overestimated service time makes the service saturate first, at a load where
the (also overestimated) replica-apply capacity hasn't been exceeded yet. The
breaking-point number is close (1.09x) by coincidence; the operational story
an on-call engineer would need — "your replicas are the risk, not your
service" — is inverted.

**Verdict:** FAIL on bottleneck identity — PASS on the 2x threshold, same
right-number-wrong-cause pattern as run 2.

---

### Run 4 — Media upload with async processing

**Prose:**

> We handle media uploads. About 50 uploads per second come in. The upload
> API is 6 instances; it accepts the file and enqueues a transcoding job — it
> returns to the client as soon as the job is queued, it does not wait for
> transcoding to finish. Transcoding is slow, it's the expensive part of this
> whole pipeline. We have 12 worker consumers pulling jobs off that queue.
> Once a worker finishes transcoding, it writes job metadata to Postgres —
> nothing else reads from that table in the request path. The Postgres pool
> is capped at 30 connections and we have no read replicas.

**Hand-model:** bottleneck = `queue` (consumer drain, 6 rps = 12 consumers /
2s), breaking point 34 rps.

**Inferred:** bottleneck = `transcodeQueue` (same component), breaking point
4 rps. Full output in `docs/inference-runs/run-4-media-upload.json`.

**What went wrong:** bottleneck identity is correct — this is the one run
where the model got the physical story right, including correctly excluding
the async transcode time from the upload API's `serviceTimeMs`. But
`consumerServiceTimeMs` was guessed at 15,000ms ("several seconds to tens of
seconds") against the hand-model's 2,000ms, a 7.5x overestimate — the same
overestimate-a-qualitative-"slow"-duration pattern as run 3's payment call.
That drove the consumer drain rate to 0.8 rps against the real 6 rps, and the
breaking point 8.5x low.

**Verdict:** PASS on bottleneck identity — FAIL on the 2x breaking-point
threshold (0.12x).

---

### Run 5 — URL shortener (live pipeline, original prompt)

Same prose as run 1, through the real `fromProse` with the unrevised
production prompt.

**Hand-model:** bottleneck = `svc`, breaking point 66,667 rps.

**Inferred:** bottleneck = `gateway`, breaking point 15,001 rps. Full output
in `docs/inference-runs/run-5-url-shortener-live-api.json`. One repair retry
needed (schema-validation failure on attempt 0, not inspected further since
attempt 1 succeeded).

**What went wrong:** the identical failure as run 1 — gateway `maxRps`
guessed at 15,000 ("sized to admit at least that with headroom, no explicit
ceiling stated") against the reference's effectively-unconstrained 100,000,
plus `serviceTimeMs` guessed at 5ms against the reference's 15ms. This is the
clearest evidence in this log that the subagent-proxy methodology wasn't an
artifact: the real pipeline, with the prompt runs 2–4's fix was never applied
to, reproduces run 1's exact failure mode.

**Verdict:** FAIL on bottleneck identity — FAIL on the 2x threshold (0.23x).

---

### Run 6 — Checkout / order placement (live pipeline)

Same prose as run 3, through the real pipeline.

**Hand-model:** bottleneck = `db` via `REPLICATION_LAG`, breaking point 978
rps.

**Inferred:** bottleneck = `payment-provider`, breaking point 417 rps. Full
output in `docs/inference-runs/run-6-checkout-live-api.json`. No repair
needed.

**What went wrong, and it's a new failure mode:** the model modelled the
synchronous call to the payment provider as its own `service` component —
1 instance, 50 concurrency, 120ms — rather than folding that latency into
`order-service`'s `serviceTimeMs` the way the hand-model does. That invented
component, with fabricated capacity numbers the prose gave no basis for,
became the dominant (fictitious) bottleneck at 417 rps — lower than even the
reference's real failure point. `src/inference/prompt.ts` never says how to
treat a synchronous call to an external system; the ad hoc instruction added
to the subagent prompts for runs 3–4 ("that call's latency counts toward
serviceTimeMs") was never ported back into the real prompt, and this is the
result: the real pipeline does *worse* here than the patched subagent did.

**Verdict:** FAIL on bottleneck identity — FAIL on the 2x threshold (0.43x).

---

### Run 7 — Media upload with async processing (live pipeline)

Same prose as run 4, through the real pipeline.

**Hand-model:** bottleneck = `queue`, breaking point 34 rps.

**Inferred:** bottleneck = `transcode-queue` (same kind), breaking point 2
rps. Full output in `docs/inference-runs/run-7-media-upload-live-api.json`.
One repair retry needed.

**What went wrong:** bottleneck identity correct again, as in run 4 — the
async-boundary handling and topology are consistently the model's strongest
area. But `consumerServiceTimeMs` was guessed at 8,000ms against the
hand-model's 2,000ms, a 4x overestimate (less extreme than run 4's 7.5x, but
the same direction and the same underlying cause: "transcoding is slow" has
no anchor). Breaking point came out 17x low.

**Verdict:** PASS on bottleneck identity — FAIL on the 2x threshold (0.06x).

---

## Where this leaves the kill criteria, after 7 of 10 runs

| Run | Method | Bottleneck match | Breaking point within 2x |
|---|---|---|---|
| 1 | subagent, initial prompt | FAIL | FAIL (0.23x) |
| 2 | subagent, refined prompt | FAIL | PASS (0.75x, coincidental) |
| 3 | subagent | FAIL | PASS (1.09x, coincidental) |
| 4 | subagent | PASS | FAIL (0.12x) |
| 5 | **live pipeline** | FAIL | FAIL (0.23x) |
| 6 | **live pipeline** | FAIL | FAIL (0.43x) |
| 7 | **live pipeline** | PASS | FAIL (0.06x) |

| Metric | All 7 | Live pipeline only (5–7) | Acceptance bar |
|---|---|---|---|
| Bottleneck identity correct | 2/7 (29%) | 1/3 (33%) | >= 8/10 (80%) |
| Breaking point within 2x | 2/7 (29%) | 0/3 (0%) | >= 7/10 (70%) |

**The live-pipeline numbers are worse than the subagent proxy's, not
better.** Both fall far short of the acceptance bar on both metrics. Two
distinct, well-understood failure mechanisms account for essentially every
miss:

1. **Guessed durations, 5–8x off in either direction**, for anything the
   prose described only qualitatively ("lookup and render," "a synchronous
   call to the payment provider," "transcoding is slow"). Present in 6 of 7
   runs. This is the dominant cause.
2. **Fabricating a capacity-constrained component with invented numbers for
   something the prose didn't describe as one** — run 6's `payment-provider`
   service, complete with a made-up instance count and concurrency limit,
   is the clearest example and is specific to the real pipeline (the ad hoc
   subagent prompts had guidance against it; the shipped prompt doesn't).

Every topology decision and every explicitly *stated* number (instance
counts, pool sizes, replica counts, TTL, consumer counts) was inferred
correctly in all 7 runs. The failure is narrow, specific, and now confirmed
on the actual production code path: **duration guesses, and occasionally
invented components, for anything not given a number in the prose.**

**This matches PLAN-0's own documented fallback almost exactly:** *"ask three
or four pointed questions before the first run (query times, read/write mix,
instance count) and infer only the rest."* Both failure mechanisms above are
about duration/capacity parameters specifically — not topology, not stated
facts. That suggests the fix is not a better prompt (prompt.ts could still be
patched with the two clarifications runs 2 and 6 point at — the gateway
default and the external-call-folding rule — but run 5 already shows that
kind of patch doesn't generalize on its own) so much as **not inferring
duration/capacity parameters from prose at all** — asking for them directly
before the first run, the way the hand-models in `models/reference.ts`
themselves were built from an engineer's actual knowledge, not a guess.

## A real engine bug, found while building run 8

Run 8 (below) is a held-out system I invented — a product-search API with a
cache in front of Elasticsearch — not something you've personally operated,
so it can't stand in for PLAN-0.5. Building its hand-model ground truth
surfaced a real, unrelated bug in the trusted engine core, not the LLM: a
cache's capacity was computed from `hitLatencyMs` (the client-observed round
trip, dominated by network transit for a remote cache) instead of the
server's actual per-op busy time, giving a 1ms cache a hard ceiling of 1,000
rps — orders of magnitude below real single-instance Redis throughput. Worse,
`deriveFindings` had no finding case for a saturated cache at all, so this was
completely silent: confirmed live in the checked-in, golden-tested
`urlShortener` reference model itself, at its own golden-tested 10,000 rps,
where the cache was already saturated (1000% utilization, Infinity latency)
while `simulate()` reported the system perfectly healthy.

Fixed: `hitLatencyMs` now feeds only the reported latency; a new `cpuTimeMs`
parameter (server-side busy time, typically microseconds for an in-memory
cache) feeds capacity; a `CACHE_SATURATED` finding now surfaces it when it
happens. Full detail in `CONTEXT.md`'s bug log and `src/components.ts`.
Verified against a hand-derived test (`tests/cacheCapacity.test.ts`) and
confirmed the existing golden-tested `urlShortener` narrative (service
bottleneck at 66,667 rps) is unchanged — the fix corrects what was hidden, it
doesn't move what was already right.

**This is worth sitting with:** the golden tests — the thing this whole
project treats as the oracle, the reason "the engine is wrong until it
reproduces the hand-model" is supposed to be a safe rule — had a real,
undetected correctness bug the entire time, because no test ever checked a
cache's own utilization. Reproducing three hand-modelled numbers is not the
same as being correct.

## Two prompt fixes, applied and verified (not just proposed)

Building run 8 also re-surfaced two failure patterns already seen in runs
1 and 5 clearly enough, on a fourth independent system, to fix rather than
just log again:

1. **Gateway `maxRps` guessed near current traffic** (runs 1, 5, 8 all did
   this) instead of a large typical default. Fixed with an explicit
   instruction in `src/inference/prompt.ts`.
2. **A cache's downstream edge additionally shrunk by the miss rate**
   (run 1, and run 8's original attempt used `callsPerRequest: 0.85` on
   `cache -> elasticsearch`), double-applying `hitRate`. Fixed with an
   explicit instruction that `hitRate` alone produces the split.

Both were verified, not just applied on faith: runs 9 and 10 re-ran the exact
same prose from runs 5 and 8 through the patched prompt. Both fixes held —
see below. This is a narrower kind of prompt change than "tune a number to
match a reference": both are structural clarifications about how the schema's
fields relate to each other, confirmed on a system outside the original
three before being written into the shipped prompt, not tuned against it.

---

### Run 9 — URL shortener (patched prompt)

Same prose as runs 1 and 5, through the real pipeline with both fixes
applied.

**Inferred:** gateway `maxRps = 50,000` (was 15,000) — fix #1 confirmed.
`cache -> db` edge is `callsPerRequest: 1` (fix #2 wasn't triggered here;
topology was already correct in this system). Full output in
`docs/inference-runs/run-9-url-shortener-patched-prompt.json`.

**What's different, and why it still fails:** with the gateway ceiling fixed,
`fromProse` now had to reckon with the newly-fixed cache's real capacity —
and had to guess the brand-new `cpuTimeMs` parameter for the first time ever,
with zero prior prompt engineering behind it. It guessed 0.05ms against the
reference default's 0.01ms — a 5x miss — which alone was enough to make the
cache the reported bottleneck at 20,000 rps (breaking point ratio 0.30x,
still a clear FAIL). This is a clean, almost experimental confirmation of the
report's central finding: guessed *durations* are the failure mode, not
topology or stated facts — reproduced immediately on a parameter that had no
history to overfit to, because it didn't exist until this session.

**Verdict:** FAIL on bottleneck identity (svc expected, cache reported) — FAIL
on the 2x threshold (0.30x). Both prompt fixes confirmed working; a new
duration-guessing failure surfaced by the very engine fix that made this
comparison meaningful in the first place.

---

### Run 10 — Product search (patched prompt)

Same prose as run 8, through the real pipeline with both fixes applied and
the corrected hand-model (`cpuTimeMs` added, ground truth recomputed:
breaking point 5,551 rps at `es`, unchanged from before the engine fix since
Elasticsearch was always the true limit here).

**Inferred:** gateway `maxRps = 50,000` (was 4,500) — fix #1 confirmed.
`search-cache -> elasticsearch` edge is `callsPerRequest: 1` (was 0.85) —
fix #2 confirmed. Full output in
`docs/inference-runs/run-10-product-search-patched-prompt.json`.

**What's different, and why it still fails:** both structural fixes held.
`queryTimeMs` for Elasticsearch was still guessed at 40ms against the
hand-model's 15ms — unrelated to either fix, the same duration-guessing
pattern as every other run. Breaking point came out at 1,469 rps.

**Caveat, disclosed plainly:** this hand-model's ground truth is my own
invented assumption (15ms for a "well-tuned" Elasticsearch query), not
verified operational fact the way the original three reference systems are
(per the README, hand-modelled by someone with real operational experience of
those systems). The model's 40ms guess for Elasticsearch under "moderate
load" is not obviously less defensible than my 15ms — full-text search
latency varies enormously by index size and query complexity, and I have no
operational grounding to say mine is right and the model's is wrong. This is
exactly the gap 0.5 exists to close: judging whether a guess is wrong
requires knowing the real number, and I don't know it for a system I made up.

**Verdict:** PASS on bottleneck identity (database, both cases) — FAIL on the
2x threshold (0.26x) — with the caveat above that "FAIL" here rests on my own
assumption, not on operational ground truth.

---

## Final tally — 10 of 10 planned runs

| Run | System | Method | Bottleneck match | Breaking point within 2x |
|---|---|---|---|---|
| 1 | url-shortener | subagent, initial prompt | FAIL | FAIL (0.23x) |
| 2 | url-shortener | subagent, ad hoc refined prompt | FAIL | PASS (0.75x, coincidental) |
| 3 | checkout | subagent | FAIL | PASS (1.09x, coincidental) |
| 4 | media-upload | subagent | PASS | FAIL (0.12x) |
| 5 | url-shortener | live, original prompt | FAIL | FAIL (0.23x) |
| 6 | checkout | live, original prompt | FAIL | FAIL (0.43x) |
| 7 | media-upload | live, original prompt | PASS | FAIL (0.06x) |
| 8 | product-search (held-out, invented) | live, original prompt | PASS | FAIL (0.26x) |
| 9 | url-shortener | live, **patched** prompt | FAIL | FAIL (0.30x) |
| 10 | product-search (held-out, invented) | live, **patched** prompt | PASS | FAIL (0.26x)* |

\* Caveat above: ground truth here is my own assumption, not operational fact.

| Metric | All 10 | Acceptance bar |
|---|---|---|
| Bottleneck identity correct | 3/10 (30%) | >= 8/10 (80%) |
| Breaking point within 2x | 2/10 (20%), both coincidental (runs 2, 3) | >= 7/10 (70%) |

**Both metrics fail their acceptance bar by a wide margin, on the real
pipeline, after fixing every implementation bug found along the way and
applying and verifying two well-evidenced prompt corrections.** This is no
longer "not yet conclusive" in the way it was at 4 or 7 runs — the fixes that
could plausibly have been the problem (schema bugs, prompt gaps) are applied
and verified, and the failure persists, unchanged in kind: every miss traces
to a guessed duration or capacity parameter for something the prose described
only qualitatively, reproduced most recently on a parameter (`cpuTimeMs`)
that came into existence during this very session with no prompt engineering
behind it at all.

**Per PLAN-0's kill criteria, this is a trigger:** "the wrong component is
named as bottleneck on systems you know" — true in 7 of 10 runs, including
the runs where the topology and every stated fact were correct. "Parameters
are consistently optimistic in a way that hides real failures" is not quite
right — the direction isn't consistent (run 5's `serviceTimeMs` was too fast,
run 9's `cpuTimeMs` and runs 3/6's payment latency were too slow) — but "off
by 5-8x in either direction on anything not explicitly stated" is its own,
equally serious failure, just not the specific optimistic-bias shape the
criterion names.

**What this doesn't settle:** run 8/10's product-search system, invented by
me, can show FAIL/PASS but can't deliver the one verdict that actually
matters here — whether a number is *true*. Every other run compares against
a hand-model that is itself just an assumption (mine, in runs 8 and 10; the
original three, hand-modelled with real operational judgment before the
engine was trusted, are stronger evidence but are not systems either of us
has operated today). **0.5 is not optional at this point — it's the only
remaining way to know whether "off by 5-8x" is actually as bad as it looks
here, on a system where the real number is known.**
