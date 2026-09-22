/**
 * The structured-output schema an LLM fills to produce a `SystemModel`.
 *
 * This mirrors `types.ts` exactly — the structured output *is* the model,
 * not something translated into one afterward. Two rules shape every field:
 *
 *   1. Every trait requires `provenance` and `rationale`. A value without a
 *      stated reason is unreviewable — the correction loop depends on the
 *      UI being able to show "we assumed no rate limiting because nothing
 *      was said".
 *   2. Reasoning fields come before value fields. Field order affects
 *      quality under constrained decoding: asking for a conclusion before
 *      its justification measurably degrades the justification.
 *
 * Traits here are categorical (booleans and small enums), never numbers —
 * this is the architect-pivot's whole point: "does this have a read
 * replica" is a question an LLM can actually answer from a sentence,
 * "what's the exact query time in milliseconds" never was.
 *
 * Cycles are rejected here, at parse time, rather than left for the solver
 * to throw on — `fromProse` should never hand `simulate()` a model it
 * hasn't already validated.
 */

import { z } from "zod";
import { MAX_BASE_COMPONENTS } from "../types.ts";
import type { Component, Edge, SystemModel } from "../types.ts";

// Exported for the same reason BooleanTraitSchema is below: this single
// object is reused across every trait in the model (ten-plus occurrences),
// and zod-to-json-schema's $refStrategy "root" needs it in an explicit
// `definitions` map or it points $ref at the first occurrence's own nested
// path (discovered live: "Reference to non-existent definition:
// #/definitions/BooleanTrait/properties/provenance") instead of a real
// top-level definition.
export const ProvenanceSchema = z.enum(["stated", "inferred", "default"]);

// Caught live: an inferred (not explicitly-stated) extended component
// occasionally got real values but throwaway one-word "rationale" text —
// "invalid", "placeholder" — that trivially passed `.min(1)` while being
// no actual reason at all. Exact-match (not substring) so a genuine
// sentence that happens to use one of these words mid-sentence — "no
// mention of it, so we assume none" — is never caught by accident.
const PLACEHOLDER_RATIONALES = new Set([
  "invalid",
  "placeholder",
  "n/a",
  "na",
  "todo",
  "tbd",
  "unknown",
  "test",
  "example",
  "none",
  "unspecified",
  "lorem ipsum",
]);

/**
 * A free-text "why" — at least a real sentence's worth, and never one of
 * the throwaway placeholders above. Shared by every structured output that
 * asks the AI for a rationale (each trait, and `explainFix`'s narration),
 * so they all reject the same degenerate answers instead of one place
 * quietly lagging behind.
 *
 * A FUNCTION, not a shared constant, on purpose: zod-to-json-schema
 * `$ref`s a schema instance reused across two fields, and every trait in a
 * model needs its own — see the note on BooleanTraitSchema below.
 */
export function rationaleSchema() {
  return (
    z
      .string()
      // A real one-line reason ("No mention of rate limiting; a basic
      // launch gateway typically lacks it") is never this short — raised
      // from `.min(1)` specifically to force out the single-word
      // placeholders above, not to demand a longer style of writing.
      .min(10, "Too short to be a real reason — write one full sentence explaining why.")
      .refine(
        (r) => !PLACEHOLDER_RATIONALES.has(r.trim().toLowerCase()),
        // Deliberately never uses the word "placeholder" (or any other
        // PLACEHOLDER_RATIONALES entry) to describe the problem, even though
        // `${r}` — the model's own bad value — is quoted for debuggability.
        // Found live: this message used to say `"${r}" is a placeholder, not
        // a reason`, which for the exact case `r === "placeholder"` put that
        // word in the model's face TWICE right before asking it to retry —
        // and the retry then reproduced the identical word on the identical
        // field. Classic priming: naming the exact banned token as the
        // category label makes the model more likely to reach for it,
        // especially when it has nothing specific to say. Say what it's NOT
        // without repeating the culprit word as the description of "wrong."
        (r) => ({
          message: `The rationale "${r}" doesn't say anything specific — write one real sentence giving the actual reason, referencing what the prose said or what's specific to this system.`,
        }),
      )
  );
}

/**
 * The failure modes that make it past strict mode's constrained decoding
 * (which already guarantees the JSON *shape* matches the schema) and can
 * only be caught by SystemModelSchema's own `superRefine` below — a
 * duplicate id, an edge to an id that doesn't exist, a cycle, or a
 * placeholder rationale (`PLACEHOLDER_RATIONALES` above) are all things
 * strict mode's compiled grammar cannot express, so the only lever against
 * them is asking for them not to happen. Interpolated into every prompt
 * that emits a `SystemModelSchema` — found live that `reworkModel.ts`'s own
 * prompt warned about cycles and the component count but not the other two,
 * and rework (editing an existing graph, not building one from nothing) is
 * exactly where a removed component's edge is most likely to survive by
 * accident. A caught validation failure means a full extra billed call (see
 * structuredCall.ts's repair-retry loop) re-sending the entire invalid
 * output as input, so avoiding the failure in the first place is strictly
 * cheaper than repairing it after the fact.
 *
 * Deliberately never spells out a PLACEHOLDER_RATIONALES word (or any past
 * tense of "that's a placeholder") as the example of what a bad rationale
 * looks like — same reasoning as the `.refine()` message above: confirmed
 * live that this backfires. Two real Re-simulates produced literally the
 * word "placeholder" as a component's actual rationale text — including one
 * that reproduced the EXACT SAME literal word on the retry immediately
 * after the repair message itself said `"placeholder" is a placeholder, not
 * a reason`. Naming the exact banned token, especially right next to the
 * word describing the category of "wrong," measurably primes the model to
 * reach for it when it has nothing specific to say. State the rule in
 * purely affirmative terms instead.
 */
export const STRUCTURAL_SELF_CHECK = `Before finishing, check your own output against these — each one is a real validation failure, not a style preference:
- No two components share an id, including ones you just added.
- Every edge's "from" and "to" is an id that exists in your OWN component list. If you remove or rename a component, remove or rewire every edge that touched it — a leftover edge to a component you dropped is a common mistake.
- No cycle: never an edge back into a component that is upstream of it.
- Every rationale is a real one-line reason tied to something specific about this system or request, never a single generic filler word standing in for one — if there's nothing specific to point to, say that as the reason itself.`;

// Exported so other structured-output schemas can build a trait shape
// without duplicating rationale/provenance/value (see extendedComponents.ts).
export function traitSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    rationale: rationaleSchema(),
    provenance: ProvenanceSchema,
    value: valueSchema,
  });
}

// Exported (unlike the enum trait schemas below) specifically because it's
// reused across multiple fields (hasRateLimiting, hasCircuitBreaker,
// hasStampedeProtection, hasDeadLetterQueue) — zod-to-json-schema treats a
// reused object identity as something to $ref, and fromProse.ts must hoist
// it into an explicit `definitions` entry or that $ref points at the first
// occurrence's own path, which the API rejects live. The enum trait
// schemas below are each structurally distinct (different value enums), so
// none of them hit this.
export const BooleanTraitSchema = traitSchema(z.boolean());

// A function, not a shared object: `id`/`label` must be a *fresh* ZodString
// instance per component schema — zod-to-json-schema treats reused object
// identity as something to $ref, and pointed that $ref straight at the
// first occurrence's in-document path, which the API rejects live.
// Exported so inference/extendedComponents.ts's own kind schemas (a
// genuinely separate tool call/schema — see that file's own top comment)
// build components the exact same shape without a second, driftable copy.
export const baseFields = () => ({
  id: z.string().min(1),
  label: z.string().min(1),
});

const GatewaySchema = z.object({
  ...baseFields(),
  kind: z.literal("gateway"),
  hasRateLimiting: BooleanTraitSchema,
});

const ServiceSchema = z.object({
  ...baseFields(),
  kind: z.literal("service"),
  instanceCount: traitSchema(z.enum(["single", "multiple"])),
  hasCircuitBreaker: BooleanTraitSchema,
});

const CacheSchema = z.object({
  ...baseFields(),
  kind: z.literal("cache"),
  ttl: traitSchema(z.enum(["short", "long"])),
  keyspaceSize: traitSchema(z.enum(["small", "large"])),
  hasStampedeProtection: BooleanTraitSchema,
});

const DatabaseSchema = z.object({
  ...baseFields(),
  kind: z.literal("database"),
  instanceCount: traitSchema(z.enum(["single", "has-replicas"])),
  writeVolume: traitSchema(z.enum(["low", "high"])),
});

const QueueSchema = z.object({
  ...baseFields(),
  kind: z.literal("queue"),
  hasDeadLetterQueue: BooleanTraitSchema,
  consumerScaling: traitSchema(z.enum(["fixed", "auto"])),
});

/**
 * The discriminated union is what makes an invented kind — a "message
 * broker" the engine doesn't support — a validation error instead of
 * something that reaches the solver.
 */
const ComponentSchema = z.discriminatedUnion("kind", [
  GatewaySchema,
  ServiceSchema,
  CacheSchema,
  DatabaseSchema,
  QueueSchema,
]);

// Exported for the same reason `baseFields` is — extendedComponents.ts's
// own schema needs the identical edge shape for the edges it proposes
// between extended-kind components and the rest of the topology.
export const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

/**
 * Discovered live: this schema (components/edges — the topology) was
 * already close enough to strict mode's compiled-grammar size limit
 * ("The compiled grammar is too large... simplify your tool schemas" — a
 * straight 400 on the request itself, not a validation failure any
 * repair retry could recover from) that there was no room left to add
 * `workload.users`/`workload.requests` here too — confirmed by binary
 * search: even a single flat 3-field object pushed it over, regardless of
 * how that object was shaped. The AI-driven flow's users/requests
 * parameters are a genuinely SEPARATE, small structured call instead
 * (`inference/workloadParameters.ts`, sized like `explainFix.ts`, both
 * confirmed live to have real headroom), run alongside this one and
 * merged into the final `SystemModel` in code.
 *
 * `workload` here is an EMPTY object — every extra field costs real,
 * scarce grammar budget, and this one was free to drop entirely rather
 * than just minimize.
 */
const WorkloadSchema = z.object({});

export const SystemModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // .min(1) here, not .min(2) — this same declaration feeds
    // buildToolInputSchema() as well as response parsing, and strict
    // mode's constrained decoding rejects the request outright for an
    // array `minItems` above 1 ("'minItems' values other than 0 or 1 are
    // not supported"), discovered live against the old numeric schema.
    // The real "at least one component beyond the gateway" check lives in
    // superRefine below instead, which zodToJsonSchema never translates
    // into the schema sent to the API in the first place.
    components: z.array(ComponentSchema).min(1),
    edges: z.array(EdgeSchema),
    workload: WorkloadSchema,
  })
  .superRefine((model, ctx) => {
    // A gateway alone does no work and models nothing — every reference
    // model has a gateway plus at least one thing actually processing the
    // request.
    if (model.components.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A capacity model needs at least one component beyond the entry point — describe what actually does the work (a service, cache, database, or queue).",
        path: ["components"],
      });
    }

    // A guardrail, not a real architectural limit — see types.ts's own
    // comment on MAX_BASE_COMPONENTS: an unbounded model costs more to
    // generate and re-generate the bigger it gets, and risks the same
    // output-length truncation structuredCall.ts's own comment documents.
    // This is the hard backstop; the prompt (prompt.ts) is what actually
    // keeps most responses well under it in the first place.
    if (model.components.length > MAX_BASE_COMPONENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Too many components (${model.components.length}) — model the core request-path topology with at most ${MAX_BASE_COMPONENTS} base components (gateway/service/cache/database/queue). Anything else (a third-party dependency, a CDN, a scheduled job, ...) is added separately — don't invent extra base components to represent it.`,
        path: ["components"],
      });
    }

    const ids = new Set(model.components.map((c) => c.id));

    const duplicates = model.components
      .map((c) => c.id)
      .filter((id, i, all) => all.indexOf(id) !== i);
    for (const id of new Set(duplicates)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate component id "${id}".`,
        path: ["components"],
      });
    }

    for (const [i, edge] of model.edges.entries()) {
      if (!ids.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge references unknown component "${edge.from}".`,
          path: ["edges", i, "from"],
        });
      }
      if (!ids.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge references unknown component "${edge.to}".`,
          path: ["edges", i, "to"],
        });
      }
    }

    if (findCycle(model.components, model.edges)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Model contains a cycle. Retries and circuit breakers are " +
          "modelled as a trait, not an edge back into an upstream component.",
        path: ["edges"],
      });
    }
  });

/** Kahn's algorithm, run for feasibility only. */
function findCycle(
  components: { id: string }[],
  edges: { from: string; to: string }[],
): boolean {
  const indegree = new Map(components.map((c) => [c.id, 0]));
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = components.filter((c) => indegree.get(c.id) === 0).map((c) => c.id);
  let visited = 0;

  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const edge of edges.filter((e) => e.from === id)) {
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }

  return visited !== components.length;
}

export type InferredSystemModel = z.infer<typeof SystemModelSchema>;

/**
 * Compile-time guarantee that the schema's inferred shape is structurally a
 * `SystemModel`. If `types.ts` grows a field this schema doesn't produce,
 * `npm run typecheck` fails here instead of the drift surfacing at runtime.
 */
function _assertSchemaProducesSystemModel(m: InferredSystemModel): SystemModel {
  return m;
}
void _assertSchemaProducesSystemModel;

// Re-exported so callers checking a hand-built model don't need their own
// component/edge import.
export type { Component, Edge };
