/**
 * Prose in, `SystemModel` out.
 *
 * Three LLM calls, not one, two of them in parallel: the topology
 * (components/edges) via tool-use for structured output, Zod validation,
 * one repair retry if validation fails — per PLAN-0.2, via
 * `structuredCall.ts`'s shared retry core (also used by `reworkModel`/
 * `identifyFailures`) — and, in parallel with it,
 * `workloadParameters.ts`'s own small call for workload.users/
 * workload.requests, genuinely separate because the topology schema had
 * no compiled-grammar room left for workload parameters too (discovered
 * live — see that file's own comment). The tool's input schema is
 * derived from `SystemModelSchema` rather than hand-duplicated, so the
 * two cannot drift out of sync.
 *
 * The third, `extendedComponents.ts`'s `proposeExtendedComponents`, runs
 * sequentially AFTER the topology call — same "no grammar room" reason
 * as workload parameters, but this one needs real base-component ids to
 * wire edges to, so it can't run in parallel with the call that produces
 * them.
 *
 * This function does not compute a single finding. It only produces the
 * model; `identifyFailures.ts`'s free-form AI call is what decides what's
 * wrong with it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BooleanTraitSchema, ProvenanceSchema, SystemModelSchema } from "./schema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { extractWorkloadParameters } from "./workloadParameters.ts";
import { proposeExtendedComponents } from "./extendedComponents.ts";
import { collapseParallelAsyncPaths, dedupeEdges } from "./lintTopology.ts";
import { findUncoveredParts } from "./coverage.ts";
import { startMinimal } from "./startMinimal.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { cleanModelIdentity, MAX_BASE_COMPONENTS, type SystemModel } from "../types.ts";

const TOOL_NAME = "emit_system_model";

/**
 * Recursively strips numeric bound keywords from a JSON Schema tree.
 *
 * Discovered live: with `strict: true` (constrained decoding), the API
 * rejects `exclusiveMinimum` outright ("For 'number' type, property
 * 'exclusiveMinimum' is not supported") — and had already rejected the
 * OpenAPI-style boolean form of the same keyword as invalid JSON Schema
 * draft 2020-12 before that. Constrained decoding apparently only grammars
 * structural keywords (type/properties/required/enum/items/anyOf), not
 * numeric ranges, at least for this API version. Rather than keep guessing
 * which numeric keyword is safe against a live, billed call, this drops all
 * of them from what's *sent to the model* — the actual bound (`.positive()`
 * on rps/callsPerRequest in schema.ts) is still enforced where it matters,
 * by SystemModelSchema.safeParse() on the returned tool call in fromProse,
 * same as the cycle/rationale checks that were never representable in JSON
 * Schema either way.
 */
function stripNumericBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripNumericBounds(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  delete obj.minimum;
  delete obj.maximum;
  delete obj.exclusiveMinimum;
  delete obj.exclusiveMaximum;
  for (const value of Object.values(obj)) stripNumericBounds(value);
}

/**
 * jsonSchema7, not openApi3: openApi3 emits the OpenAPI-style boolean
 * exclusiveMinimum/Maximum described above, which is also invalid JSON
 * Schema draft 2020-12 regardless of strict mode (confirmed against ajv's
 * 2020-12 meta-schema in tests/toolSchema.test.ts). $refStrategy "none"
 * avoids $ref/definitions. The custom cycle/rationale checks in
 * SystemModelSchema's superRefine aren't representable in JSON Schema
 * either way — they're enforced by the .parse() call in fromProse, not by
 * this.
 */
export function buildToolInputSchema(): Record<string, unknown> {
  // Two objects are reused across the schema and need an explicit
  // `definitions` entry each, or zod-to-json-schema's $refStrategy "root"
  // points their $ref at the first occurrence's own nested path instead of
  // a real top-level definition — the API rejects that live either way it
  // fails ("References must be defined under '$defs' or 'definitions'" for
  // the first form found; "Reference to non-existent definition:
  // #/definitions/BooleanTrait/properties/provenance" for the second,
  // discovered only after fixing the first):
  //   - BooleanTraitSchema itself, reused across the four boolean traits
  //     (hasRateLimiting, hasCircuitBreaker, hasStampedeProtection,
  //     hasDeadLetterQueue).
  //   - ProvenanceSchema, reused inside *every* trait schema — including
  //     the enum ones (instanceCount, ttl, ...), which are each otherwise
  //     structurally distinct and don't need hoisting themselves, but all
  //     share this one nested field.
  const schema = zodToJsonSchema(SystemModelSchema, {
    target: "jsonSchema7",
    $refStrategy: "root",
    definitions: { BooleanTrait: BooleanTraitSchema, Provenance: ProvenanceSchema },
  }) as Record<string, unknown>;
  // zodToJsonSchema stamps a draft-07 $schema pointer even under the
  // jsonSchema7 target; the actual shape it emits validates fine against
  // 2020-12, but the stale pointer itself is worth not sending.
  delete schema.$schema;
  stripNumericBounds(schema);
  return schema;
}

// Exported so reworkModel.ts (a second producer of a SystemModel, seeded
// from the current model instead of prose) can reuse the exact same tool
// definition rather than re-deriving it — this schema has already had 4
// separate live-discovered strict-mode bugs fixed in it (see
// buildToolInputSchema's comment); a second copy risks a future fix
// landing in only one of them.
export function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description:
      "Emit the inferred capacity model for the system described in the prompt.",
    // Without this, the schema is only a hint — observed live: the model
    // wrapped its answer in a spurious outer key ("model", once even
    // "parameter name") instead of matching the schema's top level exactly.
    // Every object in SystemModelSchema already has additionalProperties:
    // false and a full `required` list (Zod's default), which strict mode
    // requires — verified in tests/toolSchema.test.ts.
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

/**
 * Live latency for this call has been observed ranging ~4s-60s call to call
 * (same prompt, same model) — the tool schema is non-trivial and generation
 * length varies with how many components the model decides to emit. 90s
 * (structuredCall.ts's own default) gives real headroom above the worst
 * case seen without leaving a hung request to run indefinitely.
 */
export type FromProseOptions = StructuredCallOptions;

export interface FromProseResult {
  model: SystemModel;
  /** The tool-call arguments before validation, for docs/inference-log.md. */
  raw: unknown;
  /** True if the first attempt failed validation and the retry succeeded. */
  repaired: boolean;
}

export async function fromProse(
  description: string,
  options: FromProseOptions = {},
): Promise<FromProseResult> {
  // Two independent calls, not one — see workloadParameters.ts's own top
  // comment on why the topology schema had no room left for a workload
  // parameters field, discovered live. Run in parallel: the workload call
  // needs nothing from the topology call's result.
  const [firstDraft, workloadParameters] = await Promise.all([
    runStructuredCall(SYSTEM_PROMPT, description, SystemModelSchema, buildTool(), options, "fromProse"),
    extractWorkloadParameters(description, options),
  ]);

  // Does the draft cover every part the description names? When a named part is left
  // out, ONE more draft is asked for with those parts spelled out (see coverage.ts).
  // Skipped when the draft is already near the component cap, and never fails a build.
  let topology = firstDraft;
  if (firstDraft.data.components.length < MAX_BASE_COMPONENTS - 1) {
    const uncovered = await findUncoveredParts(description, firstDraft.data.components, options);
    if (uncovered.length > 0) {
      try {
        topology = await runStructuredCall(
          SYSTEM_PROMPT,
          `${description}\n\nA first draft of this model left out these parts the description names: ${uncovered.join("; ")}. Model each of them as a component (or fold it into an existing component only if it genuinely is one), keeping every part of the first draft and staying within ${MAX_BASE_COMPONENTS} components.`,
          SystemModelSchema,
          buildTool(),
          options,
          "fromProse:complete",
        );
      } catch {
        topology = firstDraft;
      }
    }
  }

  // Sequential, not parallel with the above — this needs real base
  // component ids to wire edges to, so it can only run once the topology
  // call has actually resolved (see extendedComponents.ts's own top
  // comment on why this is a separate call at all).
  const extended = await proposeExtendedComponents(description, topology.data, options);

  const components = [...topology.data.components, ...extended.components];
  const workload = { ...topology.data.workload, ...workloadParameters };
  const mergedEdges = dedupeEdges([...topology.data.edges, ...extended.edges]);
  // The base and extended calls could not see each other's edges, so the merged
  // wiring can contradict itself (a direct edge beside a path through a balancer or
  // queue): the deterministic rewrites settle it.
  const edges = collapseParallelAsyncPaths(components, mergedEdges);

  return {
    model: {
      ...cleanModelIdentity(topology.data),
      components: startMinimal(components, workload),
      edges,
      workload,
    },
    raw: topology.raw,
    repaired: topology.repaired,
  };
}
