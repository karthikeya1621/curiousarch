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
import { TIER_GROUP_GUIDE } from "./tierGuide.ts";
import { checkLowestTierMinimal } from "./startMinimal.ts";
import { BOTH_ENDS_RULE } from "./lintTopology.ts";
import { MAX_EXTENDED_COMPONENTS, MAX_TOTAL_COMPONENTS, type Component, type Edge, type SystemModel } from "../types.ts";

type SystemModelWorkload = SystemModel["workload"];

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

const KindDecisionSchema = z.object({
  kind: z.enum(EXTENDED_KINDS),
  needed: z.boolean(),
  evidence: z.string().min(1),
});
export type KindDecision = z.infer<typeof KindDecisionSchema>;

/**
 * What the propose step (a build) returns: a decision for EACH of the seven
 * kinds, then the components. Found live: for a description that named a load
 * balancer, object storage, a CDN, a payment provider and a nightly job, the
 * step answered with an empty list about 1 build in 4 (a 57-token reply that
 * skipped any reasoning), and the build silently lacked all five. Making the AI
 * state, per kind, whether one is needed and why — before it lists components —
 * puts the reasoning back, and gives code a structural consistency check that
 * involves no reading of the description: a kind it says is needed must come
 * back as a component, and vice versa.
 */
export const ProposeResponseSchema = z
  .object({
    considered: z.array(KindDecisionSchema),
    components: z.array(ExtendedComponentSchema),
    edges: z.array(EdgeSchema),
  })
  .superRefine((val, ctx) => {
    const kinds = val.considered.map((d) => d.kind);
    for (const kind of EXTENDED_KINDS) {
      if (kinds.filter((k) => k === kind).length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"considered" needs exactly one entry for "${kind}" - every one of the ${EXTENDED_KINDS.length} kinds must be decided.`,
          path: ["considered"],
        });
      }
    }
    const ids = val.components.map((c) => c.id);
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate component id "${id}" — every component needs a distinct id.`, path: ["components"] });
    }
    if (val.components.length > MAX_EXTENDED_COMPONENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Too many extended components (${val.components.length}) — at most ${MAX_EXTENDED_COMPONENTS} are allowed in one response.`,
        path: ["components"],
      });
    }
  });
export type ProposeResponse = z.infer<typeof ProposeResponseSchema>;

/** The AI's per-kind decisions must agree with the components it returned. */
export function checkDecisionsMatchComponents(data: { considered: KindDecision[]; components: { kind: string }[] }): string | null {
  const returned = new Set(data.components.map((c) => c.kind));
  const missing = data.considered.filter((d) => d.needed && !returned.has(d.kind)).map((d) => d.kind);
  const unexpected = [...returned].filter((k) => !data.considered.some((d) => d.kind === k && d.needed));
  const parts: string[] = [];
  if (missing.length) parts.push(`you decided ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} needed but returned no such component - add ${missing.length === 1 ? "it" : "them"}, or set needed to false`);
  if (unexpected.length) parts.push(`you returned ${unexpected.join(", ")} without deciding ${unexpected.length === 1 ? "it is" : "they are"} needed - set needed to true or remove ${unexpected.length === 1 ? "it" : "them"}`);
  return parts.length ? `Your decisions and your components disagree: ${parts.join("; and ")}.` : null;
}

/**
 * What the revise step returns. It used to re-emit every existing extended
 * component in full on every Re-simulate — most of a revise call's output, and
 * money, for components that hadn't changed. Now it lists the ids it leaves
 * exactly as they are (`keep`), returns in full only the components it ADDS or
 * CHANGES, and lists the ids it removes (`remove`, only when asked). A previous
 * component named in none of the three is a dropped one, which is checked.
 */
export const ReviseResponseSchema = z
  .object({
    keep: z.array(z.string()),
    remove: z.array(z.string()),
    components: z.array(ExtendedComponentSchema),
    edges: z.array(EdgeSchema),
  })
  .superRefine((val, ctx) => {
    const ids = val.components.map((c) => c.id);
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate component id "${id}" — every component needs a distinct id.`, path: ["components"] });
    }
    if (val.components.length > MAX_EXTENDED_COMPONENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Too many extended components (${val.components.length}) — at most ${MAX_EXTENDED_COMPONENTS} are allowed in one response.`,
        path: ["components"],
      });
    }
  });
export type ReviseResponse = z.infer<typeof ReviseResponseSchema>;

/**
 * The full extended component list a revise response describes: the previous
 * components it keeps, plus the ones it returns (added or changed), minus those
 * it removes. `problem` says what is wrong when it is inconsistent: an id that
 * was never a previous component, one both kept and returned, or — unless a
 * request may have asked for it — any previous component that is removed or not
 * mentioned at all (the wipe found on a real project).
 */
export function mergeRevision(
  previous: Component[],
  data: ReviseResponse,
  removalMayBeRequested: boolean,
): { components: Component[]; problem: string | null } {
  const previousIds = new Set(previous.map((c) => c.id));
  const keep = new Set(data.keep);
  const remove = new Set(data.remove);
  const returned = new Set(data.components.map((c) => c.id));

  const unknown = [...keep, ...remove].filter((id) => !previousIds.has(id));
  if (unknown.length > 0) {
    return { components: [], problem: `"keep" and "remove" may only list ids of the previous extended components; not previous ones: ${unknown.map((id) => `"${id}"`).join(", ")}.` };
  }
  const both = [...keep].filter((id) => returned.has(id) || remove.has(id));
  if (both.length > 0) {
    return { components: [], problem: `Each previous component is in exactly ONE of keep / components / remove; in more than one: ${both.map((id) => `"${id}"`).join(", ")}.` };
  }
  const dropped = previous.filter((c) => !keep.has(c.id) && !returned.has(c.id)).map((c) => c.id);
  if (dropped.length > 0 && !removalMayBeRequested) {
    return { components: [], problem: checkNoDroppedExtendedComponents(previous.filter((c) => dropped.includes(c.id)), { components: [] }) };
  }
  return { components: [...previous.filter((c) => keep.has(c.id)), ...data.components], problem: null };
}

const TOOL_NAME = "emit_extended_components";

export function buildExtendedToolInputSchema(responseSchema: z.ZodTypeAny = ExtendedComponentsResponseSchema): Record<string, unknown> {
  const schema = zodToJsonSchema(responseSchema, {
    target: "jsonSchema7",
    $refStrategy: "root",
    definitions: { BooleanTrait: BooleanTraitSchema, Provenance: ProvenanceSchema },
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(responseSchema: z.ZodTypeAny = ExtendedComponentsResponseSchema): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit any additional components this system needs, from a fixed extended set, plus the edges connecting them to the rest of the system.",
    strict: true,
    input_schema: buildExtendedToolInputSchema(responseSchema) as Anthropic.Tool.InputSchema,
  };
}

const KIND_GUIDE = `You may ONLY use these ${EXTENDED_KINDS.length} extended kinds — never invent another:
- "external-dependency": something outside this system's own control (a payment/auth provider, any third-party API). Traits: hasTimeout, hasFallback (true only when a real alternative exists - a second provider, a cached result, a degraded mode; a component that IS the alternative for another path, like a relay used when a direct connection fails, does not have a fallback of its own by that fact).
- "load-balancer": pure traffic distribution across instances — distinct from a gateway, which admits/rejects but doesn't distribute. Traits: instanceCount ("single"/"multiple"), hasHealthChecks. When you ADD a load balancer it sits BETWEEN its callers and what it balances: edges run caller -> load balancer -> service, and those callers no longer have a direct edge to that service. A load balancer already in the system keeps the connections it has, unless the request says otherwise.
- "message-broker": fan-out pub/sub to multiple independent consumer groups — distinct from a queue's point-to-point delivery. Traits: hasSchemaValidation, consumerScaling ("fixed"/"auto").
- "cdn": edge cache in front of an origin. Trait: hasOriginShield. Clients reach the CDN first and it pulls from the origin, so the edge runs FROM the CDN TO its origin (cdn -> origin service) and nothing calls the CDN.
- "object-storage": blob storage — distinct from a database, which is connection-pooled and query-oriented. Trait: hasVersioning.
- "scheduled-job": a cron-style background processor, outside any request path. Traits: hasLocking, isIdempotent.
- "config-store": feature flags / secrets manager / remote config, a control-plane dependency requests may need. Trait: hasLocalFallback.

Most systems need zero or one of these, but a description that NAMES one (a load balancer, a CDN, object storage, a third-party provider, a scheduled job) has stated it - include it. Only include a kind the description (or the existing system) genuinely calls for. Do not add one just to have used it, and never more than ${MAX_EXTENDED_COMPONENTS} in total. Every trait needs "rationale" (one real line of roughly 8 to 15 words tied to something specific, never a generic filler word standing in for one; if there's nothing specific to point to, say that as the reason itself) and "provenance" ("stated" the description said so, "inferred" you derived it from something else, or "default" your own reasonable choice).`;

const EDGE_REQUIREMENT = `Every component you emit MUST have at least one edge connecting it to something — either an id from the base topology you were given, or the id of another component you're emitting here. A component with no edge at all is a floating box on the diagram and is never correct: figure out which existing component would realistically call or depend on it (usually the service whose job description implies the connection), and wire it in. Never reference an id that doesn't exist in either set. ${BOTH_ENDS_RULE}`;

// Exported for tests/extendedComponents.test.ts's regression coverage on
// the "never spell out a banned rationale word" fix (see schema.ts's
// STRUCTURAL_SELF_CHECK doc comment for why that's a real, confirmed bug
// class and not a style preference).
export const PROPOSE_PROMPT = `You are reviewing a system's architecture to decide whether it needs any components from a small EXTENDED set, beyond its already-built base topology (gateway/service/cache/database/queue components, given to you as context).

${KIND_GUIDE}

${EDGE_REQUIREMENT}

This is a LEARNING TOOL: the system's workload starts at its lowest tier regardless of any scale the description states — a stated number is a future target, never the current state (the base topology you were given already reflects this). Match that same starting point: default to the minimal trait value ("single" instance, "fixed" scaling, and no protections - a timeout, a fallback, origin shielding, versioning, locking and the like stay OFF unless the description says the system has them) even when the description mentions a large eventual scale, and only choose a scaled-up value — or mark a trait "stated" — when the prose describes an actual PRESENT structural fact, not a future ambition.

How to answer: first decide, for EACH of the ${EXTENDED_KINDS.length} kinds in "considered", whether this system needs one (needed true or false) and give a short "evidence" - what the description says, or why it is not needed. Then return components for exactly the kinds you marked needed, with their edges. Deciding all seven, one by one, comes first: an answer that lists no components must come from seven considered "no" decisions, not from skipping the question.

Output only the structured decisions, components and edges. Do not add commentary.`;

export const REVISE_PROMPT = `You are reconsidering a system's EXTENDED components — the small additional set beyond its base topology (gateway/service/cache/database/queue) — as part of a broader rework of the whole system.

${KIND_GUIDE}

You will be given: the system's PREVIOUS extended components (if any), the EXISTING edges that touch them, and its freshly-reworked base topology (its current component ids — the ones you may wire edges to).

You may also be told the system's current scale. Instance counts are yours to keep right, automatically: judge a load balancer's instanceCount from that scale using the tier groups below and set it yourself as part of this revision (larger when its tier group calls for it, the smallest when the scale is low), with a rationale that names the scale.

${TIER_GROUP_GUIDE}

Every trait's rationale must be true at the system's CURRENT scale: write it fresh, never copy an old one, and never leave one that says "starting tier", "launch" or names a smaller scale; for a protection that is off, say it is not part of the described system.

Keep every existing edge exactly as it was — the same two ends and the SAME DIRECTION — as long as both ends still exist. The one exception: when a chosen fix or requested change puts a component between two ends (a queue between a job and a service), route the connection through it and remove the direct edge - keeping both leaves two competing paths. An edge's direction is meaning (which side calls or depends on which), so never reverse one, and never drop one unless the request specifically requires it. Only when a base end no longer exists (that component was replaced or removed in the rework) re-point the edge to the base component that now serves the equivalent role.

How to answer: each PREVIOUS extended component goes in exactly one place.
- "keep": the ids you leave EXACTLY as they are - and only when every rationale it carries is still true at the current scale (one that names an old scale or says "starting tier" must be returned again, fresh).
- "components": the components you ADD or CHANGE, each in full (a changed one keeps its exact same id).
- "remove": ids you take out - only when a listed fix or requested change asks for it.
"edges" is the complete list of edges touching any extended component, as before.

Add a NEW extended component only when the description, a listed fix or a requested change calls for it, or the system cannot work at its current scale without it - never because systems like this typically have one (a relay, a balancer or a job nobody described is an invention). A component you add gets its traits from the tier groups above, like the ones you keep.

The default action for every previous extended component is to KEEP it, with its EXACT same id, and keep its edge(s) as they were (see above) — re-pointing one to the equivalent base component only where its base end no longer exists (base component ids may have changed during the rework you're not shown the details of). Only drop one if the system described no longer has any plausible need for it at all - not because the base topology's ids changed, not because you're being cautious, and never as a default. This is the same "preserve by default" rule the base rework itself follows: silently losing something the user's system already had is a mistake, not a simplification. Only mint a new id for something genuinely new that didn't exist before.

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
 *   4. Point every edge into a CDN the other way (CDN -> origin).
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
  // A CDN fronts its origin: clients reach it, it calls the origin. An edge
  // INTO one is backwards — and the prompt asking for the right direction
  // wasn't enough (found live: a fresh Zoom-like build still drew
  // `livestream-service -> livestream-cdn`). The direction is never
  // ambiguous, so it's fixed here in code, for free. This also corrects an
  // older project's reversed edge on its next Re-simulate.
  const cdnIds = new Set(components.filter((c) => c.kind === "cdn").map((c) => c.id));
  const validEdges = response.edges
    .filter((e) => allIds.has(e.from) && allIds.has(e.to))
    .map((e) => (cdnIds.has(e.to) && !cdnIds.has(e.from) ? { ...e, from: e.to, to: e.from } : e));

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
    ProposeResponseSchema,
    buildTool(ProposeResponseSchema),
    {
      ...options,
      // A response with no "considered" list (older callers, canned test
      // responses) is read as: needed exactly for the kinds it returned.
      normalizeOutput: (raw) => {
        if (typeof raw !== "object" || raw === null || "considered" in raw) return raw;
        const comps = Array.isArray((raw as { components?: unknown }).components) ? ((raw as { components: { kind?: string }[] }).components) : [];
        const present = new Set(comps.map((c) => c?.kind));
        return { ...(raw as object), considered: EXTENDED_KINDS.map((kind) => ({ kind, needed: present.has(kind), evidence: present.has(kind) ? "returned" : "not needed" })) };
      },
      validateResult: (data) => checkDecisionsMatchComponents(data as ProposeResponse),
    },
    "proposeExtendedComponents",
  );
  return sanitizeExtendedResponse(
    { components: result.data.components, edges: result.data.edges } as ExtendedComponentsResponse,
    new Set(baseModel.components.map((c) => c.id)),
    remaining,
  ) as { components: Component[]; edges: Edge[] };
}

/**
 * Enforces, in code, the rule REVISE_PROMPT states: every existing edge
 * touching an extended component survives (same ends, same direction) while
 * both its ends still exist. Found live on a real Re-simulate: this step
 * dropped `video-service -> transcode-job` and `cdn -> video-service` and
 * reversed `video-service -> object-storage`, leaving a background job and a
 * CDN with no incoming edge — which the canvas then draws as user traffic
 * flowing straight into them. It had never been shown the existing edges, so
 * it re-invented the wiring from component names alone; it now is (see
 * `previousEdges`), and this is the backstop for when it still doesn't keep
 * them. A reversed edge is caught too: the original is missing.
 *
 * An end that no longer exists (a component the rework removed, or an
 * extended one this call chose to drop) exempts its edges — nothing to keep.
 * Same reasoning as reworkModel.ts's `checkNoDroppedEdges`, which covers the
 * base half of the graph.
 */
export function checkNoDroppedExtendedEdges(
  previousEdges: Edge[],
  reworkedBaseIds: ReadonlySet<string>,
  result: { components: { id: string }[]; edges: Edge[] },
  /** The reworked base call's own edges — a path may run through them (extended -> queue -> base). */
  baseEdges: Edge[] = [],
): string | null {
  const resultIds = new Set(result.components.map((c) => c.id));
  const exists = (id: string) => reworkedBaseIds.has(id) || resultIds.has(id);
  // What must survive is the connection, not the literal edge: a fix that
  // inserts a queue between a job and a service replaces their direct edge
  // with a path through it (found live: the strict version rejected exactly
  // that, and the retry kept both, leaving two competing paths). Judged on
  // unique pairs, over the extended and base edges together. A reversed edge
  // is still caught: the original direction has no path.
  const next = new Map<string, string[]>();
  for (const e of [...baseEdges, ...result.edges]) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const reachable = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(next.get(from) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return false;
  };
  const seenPairs = new Set<string>();
  const dropped = previousEdges.filter((e) => {
    const key = `${e.from}\u0000${e.to}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return exists(e.from) && exists(e.to) && !reachable(e.from, e.to);
  });
  if (dropped.length === 0) return null;

  const list = dropped.map((e) => `"${e.from}" -> "${e.to}"`).join(", ");
  const noun = dropped.length === 1 ? "edge" : "edges";
  const them = dropped.length === 1 ? "it" : "them";
  return (
    `You dropped or reversed ${dropped.length} existing ${noun} whose ends both still exist: ${list}. ` +
    `Every existing edge must still be present in the same direction (or reachable through a component that was ` +
    `inserted between its ends) — restore ${them}, unless the request specifically required removing ${them}.`
  );
}

/**
 * Every extended component that existed before must still exist. Found on a
 * real project: a Re-simulate at 1M users (nothing queued) handed the revise
 * step six previous extended components and it answered with an empty list —
 * the payment provider, push provider, CDN, recording storage, nightly job and
 * load balancer all vanished, and the next Re-simulate treated the system as if
 * they had never existed. `checkNoDroppedExtendedEdges` couldn't catch it: a
 * component that no longer exists exempts its edges. This is a continuity
 * invariant, like the edge one: removing something is only ever a response to a
 * request, so with nothing queued a missing component is an error, and the AI is
 * told which ones to restore.
 */
export function checkNoDroppedExtendedComponents(
  previous: { id: string }[],
  result: { components: { id: string }[] },
): string | null {
  const kept = new Set(result.components.map((c) => c.id));
  const dropped = previous.filter((c) => !kept.has(c.id)).map((c) => c.id);
  if (dropped.length === 0) return null;
  const noun = dropped.length === 1 ? "component" : "components";
  const them = dropped.length === 1 ? "it" : "them";
  return (
    `You dropped ${dropped.length} existing extended ${noun} without being asked to: ${dropped.map((id) => `"${id}"`).join(", ")}. ` +
    `Every existing extended component must stay, with its same id and its edges - restore ${them}. ` +
    `Removing one is only for a request that specifically asks for it.`
  );
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
  /**
   * The edges of the model being revised that touch one of `previousExtended`
   * (from -> to; direction is meaning). Shown to the AI so it keeps the
   * existing wiring instead of re-deriving it from names, and enforced by
   * `checkNoDroppedExtendedEdges`. Omitted (nothing to keep) on a first
   * proposal.
   */
  previousEdges: Edge[] = [],
  /**
   * True when a fix or chat change is queued: it may ask for a component to be
   * removed, so a missing one is no longer an error by itself. False (nothing
   * asked): every previous extended component must survive.
   */
  removalMayBeRequested = false,
  /** Passed when nothing is queued: the workload, so a value above the minimum at the LOWEST tier can be named and repaired. */
  minimalAtWorkload?: SystemModelWorkload,
): Promise<{ components: Component[]; edges: Edge[] }> {
  const { remaining, text: budget } = budgetLine(reworkedBaseModel.components.length);
  const baseIds = new Set(reworkedBaseModel.components.map((c) => c.id));
  const existingEdges =
    previousEdges.length > 0 ? `\n\nExisting edges touching them (from -> to):\n${JSON.stringify(previousEdges)}` : "";
  const baseEdges = (reworkedBaseModel as { edges?: Edge[] }).edges ?? [];
  const result = await runStructuredCall(
    REVISE_PROMPT,
    `Previous extended components:\n${JSON.stringify(previousExtended)}${existingEdges}\n\nFreshly reworked base topology:\n${baseComponentContext(reworkedBaseModel)}\n\n${budget}${additionalContext ?? ""}`,
    ReviseResponseSchema,
    buildTool(ReviseResponseSchema),
    {
      maxRetries: 2,
      ...options,
      // A response that omits keep/remove (older callers, canned test responses)
      // means "nothing kept, nothing removed": every previous component it still
      // wants must be returned in full, as before.
      normalizeOutput: (raw) => (typeof raw === "object" && raw !== null ? { keep: [], remove: [], ...(raw as object) } : raw),
      validateResult: (data) => {
        const merged = mergeRevision(previousExtended, data as ReviseResponse, removalMayBeRequested);
        if (merged.problem) return merged.problem;
        const notMinimal = minimalAtWorkload ? checkLowestTierMinimal(merged.components, minimalAtWorkload) : null;
        if (notMinimal) return notMinimal;
        return checkNoDroppedExtendedEdges(
          previousEdges,
          baseIds,
          { components: merged.components, edges: (data as ReviseResponse).edges },
          baseEdges,
        );
      },
    },
    "reviseExtendedComponents",
  );
  const merged = mergeRevision(previousExtended, result.data, removalMayBeRequested);
  return sanitizeExtendedResponse(
    { components: merged.components, edges: result.data.edges } as ExtendedComponentsResponse,
    new Set(reworkedBaseModel.components.map((c) => c.id)),
    remaining,
  ) as { components: Component[]; edges: Edge[] };
}
