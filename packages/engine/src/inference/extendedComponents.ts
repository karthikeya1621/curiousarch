/**
 * The 7 "extended" component kinds (external dependency, load balancer,
 * message broker, CDN, object storage, scheduled job, config store) —
 * genuinely separate structured calls from the main topology call
 * (`fromProse.ts`/`reworkModel.ts`'s `SystemModelSchema`/`buildTool`),
 * never a field or a discriminated-union member added to it.
 *
 * Why separate: `SystemModelSchema` was already documented (see
 * `workloadParameters.ts`'s own top comment) as sitting right at
 * Anthropic's strict-mode compiled-grammar size limit — confirmed live
 * that even a single flat 3-field object couldn't be added to it. Seven
 * more discriminated-union component kinds, each with their own trait
 * objects, is a much bigger addition than that; it goes in its own call,
 * sized like this file's schema alone, with real headroom.
 *
 * Two entry points, not one, because "propose fresh" and "revise
 * existing" are different prompts even though they share a schema:
 * `proposeExtendedComponents` (fromProse — nothing existed yet) and
 * `reviseExtendedComponents` (reworkModel — some may already exist and
 * should keep their id if they still conceptually apply, exactly the
 * continuity rule REWORK_PROMPT already applies to base components).
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  baseFields,
  BooleanTraitSchema,
  EdgeSchema,
  ProvenanceSchema,
  traitSchema,
} from "./schema.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { MAX_EXTENDED_COMPONENTS, MAX_TOTAL_COMPONENTS, type Component, type Edge } from "../types.ts";

const ExternalDependencySchema = z.object({
  ...baseFields(),
  kind: z.literal("external-dependency"),
  hasTimeout: BooleanTraitSchema,
  hasFallback: BooleanTraitSchema,
});

const LoadBalancerSchema = z.object({
  ...baseFields(),
  kind: z.literal("load-balancer"),
  instanceCount: traitSchema(z.enum(["single", "multiple"])),
  hasHealthChecks: BooleanTraitSchema,
});

const MessageBrokerSchema = z.object({
  ...baseFields(),
  kind: z.literal("message-broker"),
  hasSchemaValidation: BooleanTraitSchema,
  consumerScaling: traitSchema(z.enum(["fixed", "auto"])),
});

const CdnSchema = z.object({
  ...baseFields(),
  kind: z.literal("cdn"),
  hasOriginShield: BooleanTraitSchema,
});

const ObjectStorageSchema = z.object({
  ...baseFields(),
  kind: z.literal("object-storage"),
  hasVersioning: BooleanTraitSchema,
});

const ScheduledJobSchema = z.object({
  ...baseFields(),
  kind: z.literal("scheduled-job"),
  hasLocking: BooleanTraitSchema,
  isIdempotent: BooleanTraitSchema,
});

const ConfigStoreSchema = z.object({
  ...baseFields(),
  kind: z.literal("config-store"),
  hasLocalFallback: BooleanTraitSchema,
});

const ExtendedComponentSchema = z.discriminatedUnion("kind", [
  ExternalDependencySchema,
  LoadBalancerSchema,
  MessageBrokerSchema,
  CdnSchema,
  ObjectStorageSchema,
  ScheduledJobSchema,
  ConfigStoreSchema,
]);

/** Reused by reworkModel.ts to split a model's components into "the main topology call still owns this" vs "this call owns this" before/after each rework. */
export const EXTENDED_KINDS = [
  "external-dependency",
  "load-balancer",
  "message-broker",
  "cdn",
  "object-storage",
  "scheduled-job",
  "config-store",
] as const satisfies readonly Component["kind"][];

export function isExtendedComponent(component: Component): boolean {
  return (EXTENDED_KINDS as readonly string[]).includes(component.kind);
}

export const ExtendedComponentsResponseSchema = z
  .object({
    components: z.array(ExtendedComponentSchema),
    edges: z.array(EdgeSchema),
  })
  // Same duplicate-id check SystemModelSchema already does for the base
  // topology (schema.ts) — found live: without it, nothing stopped the AI
  // from emitting two components with the same id in one response (e.g.
  // both literally named "scheduled-job"), which React Flow then choked
  // on as a duplicate key when the diagram tried to render both nodes'
  // synthetic traffic edge under one identical key.
  .superRefine((val, ctx) => {
    const ids = val.components.map((c) => c.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of new Set(duplicates)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate component id "${id}" — every component, including ones from earlier in this same response, needs a distinct id.`,
        path: ["components"],
      });
    }

    // Same guardrail reasoning as SystemModelSchema's own MAX_BASE_COMPONENTS
    // check (types.ts) — this call's own hard ceiling, independent of how
    // much room is actually left against MAX_TOTAL_COMPONENTS (the caller
    // enforces that narrower, per-request budget itself; see
    // proposeExtendedComponents/reviseExtendedComponents).
    if (val.components.length > MAX_EXTENDED_COMPONENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Too many extended components (${val.components.length}) — at most ${MAX_EXTENDED_COMPONENTS} are allowed in one response.`,
        path: ["components"],
      });
    }
  });

export type ExtendedComponentsResponse = z.infer<typeof ExtendedComponentsResponseSchema>;

const TOOL_NAME = "emit_extended_components";

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(ExtendedComponentsResponseSchema, {
    target: "jsonSchema7",
    $refStrategy: "root",
    definitions: { BooleanTrait: BooleanTraitSchema, Provenance: ProvenanceSchema },
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit any additional components this system needs, from a fixed extended set, plus the edges connecting them to the rest of the system.",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

const KIND_GUIDE = `You may ONLY use these ${EXTENDED_KINDS.length} extended kinds — never invent another:
- "external-dependency": something outside this system's own control (a payment/auth provider, any third-party API). Traits: hasTimeout, hasFallback.
- "load-balancer": pure traffic distribution across instances — distinct from a gateway, which admits/rejects but doesn't distribute. Traits: instanceCount ("single"/"multiple"), hasHealthChecks.
- "message-broker": fan-out pub/sub to multiple independent consumer groups — distinct from a queue's point-to-point delivery. Traits: hasSchemaValidation, consumerScaling ("fixed"/"auto").
- "cdn": edge cache in front of an origin. Trait: hasOriginShield.
- "object-storage": blob storage — distinct from a database, which is connection-pooled and query-oriented. Trait: hasVersioning.
- "scheduled-job": a cron-style background processor, outside any request path. Traits: hasLocking, isIdempotent.
- "config-store": feature flags / secrets manager / remote config, a control-plane dependency requests may need. Trait: hasLocalFallback.

Most systems need zero or one of these — only include a kind the description (or the existing system) genuinely calls for. Do not add one just to have used it, and never more than ${MAX_EXTENDED_COMPONENTS} in total. Every trait needs "rationale" (one line — never a placeholder like "n/a" or "invalid"; if there's nothing specific to point to, say so as the reason itself) and "provenance" ("stated" the description said so, "inferred" you derived it from something else, or "default" your own reasonable choice).`;

const EDGE_REQUIREMENT = `Every component you emit MUST have at least one edge connecting it to something — either an id from the base topology you were given, or the id of another component you're emitting here. A component with no edge at all is a floating box on the diagram and is never correct: figure out which existing component would realistically call or depend on it (usually the service whose job description implies the connection), and wire it in. Never reference an id that doesn't exist in either set.`;

const PROPOSE_PROMPT = `You are reviewing a system's architecture to decide whether it needs any components from a small EXTENDED set, beyond its already-built base topology (gateway/service/cache/database/queue components, given to you as context).

${KIND_GUIDE}

${EDGE_REQUIREMENT}

This is a LEARNING TOOL: the system's workload starts at its lowest tier regardless of any scale the description states — a stated number is a future target, never the current state (the base topology you were given already reflects this). Match that same starting point: default to the minimal trait value ("single" instance, "fixed" scaling, and so on) even when the description mentions a large eventual scale, and only choose a scaled-up value — or mark a trait "stated" — when the prose describes an actual PRESENT structural fact, not a future ambition.

Output only the structured components and edges. Do not add commentary.`;

const REVISE_PROMPT = `You are reconsidering a system's EXTENDED components — the small additional set beyond its base topology (gateway/service/cache/database/queue) — as part of a broader rework of the whole system.

${KIND_GUIDE}

You will be given: the system's PREVIOUS extended components (if any), and its freshly-reworked base topology (its current component ids — the ones you may wire edges to).

The default action for every previous extended component is to KEEP it, with its EXACT same id, and RE-WIRE its edge(s) to whatever base component now serves the equivalent role (base component ids may have changed during the rework you're not shown the details of). Only drop one if the system described no longer has any plausible need for it at all - not because the base topology's ids changed, not because you're being cautious, and never as a default. This is the same "preserve by default" rule the base rework itself follows: silently losing something the user's system already had is a mistake, not a simplification. Only mint a new id for something genuinely new that didn't exist before.

You may also be given additional context about a specific request already being applied elsewhere to this system right now - a chat-requested change, or a fix the user explicitly chose. If it calls for adding, modifying, or removing one of your own extended-kind components, implement that now; it takes priority over "preserve by default" above where the two genuinely conflict. If none is given, or it has nothing to do with your kinds, "preserve by default" is all that applies.

${EDGE_REQUIREMENT}

Output only the structured components and edges. Do not add commentary.`;

/**
 * Two defensive passes before anything reaches the model, on top of the
 * schema's own within-response duplicate-id check (which can't see the
 * base model's ids, since the schema is defined once, not per-call):
 *   1. Drop any proposed component whose id collides with a BASE model
 *      id — the base component wins, since it already existed.
 *   2. Truncate to `maxComponents` (the remaining MAX_TOTAL_COMPONENTS
 *      budget for this specific call — see `budgetLine`) if the AI still
 *      exceeded it despite being told the number, keeping the first
 *      `maxComponents` in response order.
 *   3. Drop any edge whose endpoint isn't an actually-known id (base or
 *      one of the surviving new components).
 * A React key collision (two nodes rendered under the same id) is
 * exactly what this whole function exists to make structurally
 * impossible, not just unlikely — the size cap is the same "don't just
 * trust the prompt" principle applied to cost/size instead of identity.
 */
function sanitizeExtendedResponse(
  response: ExtendedComponentsResponse,
  knownIds: Set<string>,
  maxComponents: number,
): ExtendedComponentsResponse {
  const components = response.components.filter((c) => !knownIds.has(c.id)).slice(0, maxComponents);
  const allIds = new Set([...knownIds, ...components.map((c) => c.id)]);
  const validEdges = response.edges.filter((e) => allIds.has(e.from) && allIds.has(e.to));

  // Same class of bug as the duplicate-id check above, one layer down —
  // found live: the AI can also emit the exact same {from, to} edge twice
  // within one response, which React Flow then renders as two elements
  // under the one key it derives from an edge's endpoints. Edges have no
  // other identity beyond their endpoints, so silently collapsing exact
  // duplicates (not a repair-retry-worthy error, just harmless redundancy)
  // is the right fix, unlike a duplicate component id.
  const seen = new Set<string>();
  const edges = validEdges.filter((e) => {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { components, edges };
}

/**
 * Only `id`/`label`/`kind` are ever read from the base model here — a
 * minimal structural type instead of `Pick<SystemModel, "components">`
 * (which would demand every base component's full trait shape) so a
 * caller (production or test) never needs more than this actually uses.
 */
export interface BaseComponentRef {
  id: string;
  label: string;
  kind: string;
}

function baseComponentContext(model: { components: BaseComponentRef[] }): string {
  return JSON.stringify(model.components.map((c) => ({ id: c.id, label: c.label, kind: c.kind })));
}

/**
 * The static per-call ceiling (KIND_GUIDE's own MAX_EXTENDED_COMPONENTS
 * mention) doesn't know how big the base topology already is — this is
 * the actual remaining room against MAX_TOTAL_COMPONENTS for THIS
 * request specifically, computed in code (not left to the AI to do the
 * arithmetic) and stated plainly in the user content, which is where
 * per-call, non-cacheable specifics belong (same reasoning
 * reworkModel.ts's own comment gives for pendingFixes).
 */
function budgetLine(baseCount: number): { remaining: number; text: string } {
  const remaining = Math.max(0, Math.min(MAX_EXTENDED_COMPONENTS, MAX_TOTAL_COMPONENTS - baseCount));
  const text =
    remaining === 0
      ? `The base topology already has ${baseCount} components, at the ${MAX_TOTAL_COMPONENTS}-component overall limit — add NO extended components this time.`
      : `The base topology has ${baseCount} components — you may add at most ${remaining} extended component(s) without exceeding the ${MAX_TOTAL_COMPONENTS}-component overall limit.`;
  return { remaining, text };
}

export async function proposeExtendedComponents(
  description: string,
  baseModel: { components: BaseComponentRef[] },
  options: StructuredCallOptions = {},
): Promise<{ components: Component[]; edges: Edge[] }> {
  const { remaining, text: budget } = budgetLine(baseModel.components.length);
  const result = await runStructuredCall(
    PROPOSE_PROMPT,
    `System description:\n${description}\n\nBase topology already built:\n${baseComponentContext(baseModel)}\n\n${budget}`,
    ExtendedComponentsResponseSchema,
    buildTool(),
    options,
    "proposeExtendedComponents",
  );
  return sanitizeExtendedResponse(
    result.data,
    new Set(baseModel.components.map((c) => c.id)),
    remaining,
  ) as { components: Component[]; edges: Edge[] };
}

export async function reviseExtendedComponents(
  previousExtended: Component[],
  reworkedBaseModel: { components: BaseComponentRef[] },
  options: StructuredCallOptions = {},
  /**
   * Freeform, pre-formatted context about a specific request driving this
   * revision — a chat message (chatWithProject.ts) or a formatted pending-
   * fixes list (reworkModel.ts's own `formatPendingFixes`) — appended
   * verbatim, or omitted for a plain holistic reconsideration with no
   * specific request behind it. Each caller owns its own wording; this
   * function only appends whatever it's given. See REVISE_PROMPT's own
   * paragraph on how it's weighed against "preserve by default".
   */
  additionalContext?: string,
): Promise<{ components: Component[]; edges: Edge[] }> {
  const { remaining, text: budget } = budgetLine(reworkedBaseModel.components.length);
  const result = await runStructuredCall(
    REVISE_PROMPT,
    `Previous extended components:\n${JSON.stringify(previousExtended)}\n\nFreshly reworked base topology:\n${baseComponentContext(reworkedBaseModel)}\n\n${budget}${additionalContext ?? ""}`,
    ExtendedComponentsResponseSchema,
    buildTool(),
    { maxRetries: 2, ...options },
    "reviseExtendedComponents",
  );
  return sanitizeExtendedResponse(
    result.data,
    new Set(reworkedBaseModel.components.map((c) => c.id)),
    remaining,
  ) as { components: Component[]; edges: Edge[] };
}
