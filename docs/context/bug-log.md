# Bugs already found and fixed (pre-pivot and early)

> Part of the project context; the index is [`CONTEXT.md`](../../CONTEXT.md). The bugs found during this project's live rounds are in the topical files (`inference-reliability.md`, `topology-rules.md`, `scale-and-minimal.md`, `live-testing-log.md`); this file keeps the earlier ones, whose *shape* recurred across engine generations.

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
