/**
 * The structured-output schema an LLM fills to produce a `SystemModel`.
 *
 * This mirrors `types.ts` exactly — the structured output *is* the model,
 * not something translated into one afterward. Two rules from PLAN-0.1 shape
 * every field:
 *
 *   1. Every parameter requires `provenance` and `rationale`. A value without
 *      a stated reason is unreviewable — the correction loop depends on the
 *      UI being able to show "we guessed 8ms because X".
 *   2. Reasoning fields come before value fields. Field order affects
 *      quality under constrained decoding: asking for a conclusion before
 *      its justification measurably degrades the justification.
 *
 * Cycles are rejected here, at parse time, rather than left for the solver to
 * throw on — `fromProse` should never hand `simulate()` a model it hasn't
 * already validated.
 */

import { z } from "zod";
import type { Component, Edge, SystemModel } from "../types.ts";

const ProvenanceSchema = z.enum(["stated", "inferred", "default"]);

/**
 * Field order is deliberate: rationale (the reasoning) precedes provenance
 * (the classification that reasoning supports), which precedes value and
 * unit (the conclusion). Do not reorder this without re-reading PLAN-0.1.
 */
export const ParameterSchema = z.object({
  rationale: z
    .string()
    .min(1, "Every parameter needs a one-line reason, even for a default."),
  provenance: ProvenanceSchema,
  value: z.number(),
  unit: z.string(),
});

// A function, not a shared object: `id`/`label` must be a *fresh* ZodString
// instance per component schema. zod-to-json-schema treats reused object
// identity as something to $ref, and pointed that $ref straight at the first
// occurrence's in-document path — the API rejects that live ("References
// must be defined under '$defs' or 'definitions'"). Parameter is reused
// deliberately and hoisted into `definitions` in fromProse.ts; these tiny
// primitives aren't worth that ceremony, so each component just gets its own.
const baseFields = () => ({
  id: z.string().min(1),
  label: z.string().min(1),
});

const GatewaySchema = z.object({
  ...baseFields(),
  kind: z.literal("gateway"),
  maxRps: ParameterSchema,
});

const ServiceSchema = z.object({
  ...baseFields(),
  kind: z.literal("service"),
  instances: ParameterSchema,
  concurrencyPerInstance: ParameterSchema,
  serviceTimeMs: ParameterSchema,
});

const CacheSchema = z.object({
  ...baseFields(),
  kind: z.literal("cache"),
  hitRate: ParameterSchema,
  hitLatencyMs: ParameterSchema,
  cpuTimeMs: ParameterSchema,
  ttlSeconds: ParameterSchema,
  keyspaceHotSet: ParameterSchema,
});

const DatabaseSchema = z.object({
  ...baseFields(),
  kind: z.literal("database"),
  connectionPoolSize: ParameterSchema,
  queryTimeMs: ParameterSchema,
  writeRatio: ParameterSchema,
  readReplicas: ParameterSchema,
  replicaApplyRate: ParameterSchema,
});

const QueueSchema = z.object({
  ...baseFields(),
  kind: z.literal("queue"),
  capacity: ParameterSchema,
  consumers: ParameterSchema,
  consumerServiceTimeMs: ParameterSchema,
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

const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  callsPerRequest: z.number().positive(),
});

const WorkloadSchema = z.object({
  rps: z.number().positive(),
  payloadKb: z.number().positive().optional(),
});

export const SystemModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // .min(1) here, not .min(2) — this same declaration feeds
    // buildToolInputSchema() as well as response parsing, and strict mode's
    // constrained decoding rejects the request outright for an array
    // `minItems` above 1 ("'minItems' values other than 0 or 1 are not
    // supported"), discovered live. The real "at least one component beyond
    // the gateway" check lives in superRefine below instead, which
    // zodToJsonSchema never translates into the schema sent to the API in
    // the first place (same reason the cycle/dangling-edge checks live
    // there) — so it can be as strict as it needs to be without touching
    // what the live call is allowed to ask for.
    components: z.array(ComponentSchema).min(1),
    edges: z.array(EdgeSchema),
    workload: WorkloadSchema,
  })
  .superRefine((model, ctx) => {
    // A gateway alone does no work and models nothing — every reference
    // model has a gateway plus at least one thing actually processing the
    // request. Found live: a bare-gateway model passed every other check
    // here and reached simulate() as a trivially "healthy" system that said
    // nothing, for a prose description that was clearly about more than
    // admission control (see CONTEXT.md's movie-ticket-booking test).
    if (model.components.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A capacity model needs at least one component beyond the entry point — describe what actually does the work (a service, cache, database, or queue).",
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
          "parameters, not edges back into an upstream component.",
        path: ["edges"],
      });
    }
  });

/** Kahn's algorithm, run for feasibility only — same check `solver.ts` makes. */
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
