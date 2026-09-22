/**
 * "Re-simulate": a full rebuild of the current system, seeded from its own
 * current state instead of typed prose. Same category of operation as
 * `fromProse` — produce a candidate `SystemModel` — and shares its exact
 * validated, retried, strict-mode-hardened call via `structuredCall.ts`'s
 * `runStructuredCall` (see that file's own comment on why this is shared
 * rather than duplicated).
 *
 * This produces a model, never a finding. Whatever the rework changes,
 * `identifyFailures.ts` is what decides what's wrong with the result —
 * called again after every rework, exactly as it's called after every
 * other model change.
 *
 * A validation failure here is expensive twice over — it costs a full
 * extra billed attempt (structuredCall.ts's repair-retry loop re-sends the
 * entire invalid model as input), and this call's own `maxRetries` is 2, not
 * 1, so a bad prompt here compounds harder than anywhere else in the
 * engine. Strict mode already guarantees the JSON *shape* is valid; the
 * only failures actually reachable are the ones only Zod's `superRefine`
 * can catch (schema.ts's `STRUCTURAL_SELF_CHECK`, interpolated into the
 * prompt below) — and rework, which edits an existing graph rather than
 * building one from nothing, is exactly where those show up (a removed
 * component's edge left dangling; a reused id). Prompted against
 * specifically after a user-reported retry cost concern; apps/web's usage
 * tracking (`ai_calls.attempt`/`ai_label_stats.retry_pct`) is what actually
 * measures whether this reduced the real rate — check it before tightening
 * further.
 *
 * Unlike `fromProse`, there's no separate workload-parameters call here.
 * The user sets a new tier by moving a control, not by describing one —
 * Re-simulate's job is reworking the ARCHITECTURE for a tier that's
 * already set, not deciding the tier itself. `workload.users`/
 * `workload.requests` are carried forward from the input model unchanged;
 * the AI sees them (as context, in the JSON dump below) but its own
 * output schema never asks it to reproduce them.
 *
 * `pendingFixes` (optional): fixes the user has explicitly chosen since
 * the last Re-simulate, queued rather than implemented immediately (see
 * apps/web/lib/store.ts's own comment on `pendingFixes` — this is the
 * cost-saving trade that used to mean a separate `applyAiFix` call per
 * fix). They're appended to the USER content, not REWORK_PROMPT itself,
 * so the static system prompt stays byte-identical (and therefore
 * cacheable) across every rework call regardless of how many fixes are
 * queued this time.
 *
 * `pendingChanges` (optional): changes the user asked for in chat since the
 * last Re-simulate. Chat no longer edits the model itself — it queues the
 * request, and this call is what implements it (alongside `pendingFixes`,
 * same user-content placement and for the same caching reason). Each carries
 * the user's own words AND a self-contained instruction written when the
 * message was sent (references like "it"/"that one" already resolved against
 * the conversation and any earlier queued change), so nothing about what was
 * meant is lost by the time the conversation has scrolled out of the chat
 * history window.
 *
 * A second call, sequential and unconditional, always follows the base
 * rework above: `extendedComponents.ts`'s `reviseExtendedComponents`
 * re-evaluates any components of the 7 "extended" kinds (external
 * dependency, load balancer, ...) this system has. Same "no compiled-
 * grammar room" reason those kinds aren't part of `SystemModelSchema` at
 * all — the base call above literally cannot represent them in its own
 * output, so it's told to treat them as context-only and never emit one
 * or an edge touching one; this second call is what actually keeps them
 * up to date, using the base call's freshly reworked component ids to
 * rewire their edges correctly.
 */

import { STRUCTURAL_SELF_CHECK, SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { EXTENDED_KINDS, isExtendedComponent, reviseExtendedComponents } from "./extendedComponents.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { MAX_BASE_COMPONENTS, type Component, type SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and its workload.users/workload.requests for context (each has "included": whether that dimension is relevant to this system, "tier": the current rough step on a small ladder, and "target": the original ambition for it). Some of it may already reflect real fixes that were applied (an added component, a corrected trait). You may also be given a list of specific fixes the user has already chosen to apply, and a list of changes the user asked for in chat.

If specific fixes or requested changes are listed, implement each of them precisely first - they are already-decided choices, not suggestions to evaluate. Requested changes are listed oldest first; where a later one conflicts with (or cancels) an earlier one, the later one wins. If a requested change is about one of the EXTENDED kinds described below, do not attempt it yourself - the separate step that owns those kinds implements it, so your own output simply doesn't change on account of that part of the request; only make a base-kind change for a request that genuinely calls for one. Then reconsider the ARCHITECTURE holistically on top of that, the way an architect revisiting a system does: given where this system stands now (including its current scale), does it call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything else exactly as it is if nothing more is warranted - do not change something just to have changed it. You are not deciding the workload parameters themselves - only the architecture that serves them.

Some components in the model may be of an EXTENDED kind (${EXTENDED_KINDS.join(", ")}) - these are shown to you for context only and are reworked by a separate step, never by you. Your own output must never include one of these kinds, and their ids are OFF LIMITS to you entirely - never reuse one of their ids for a component of your own, even a base-kind one that seems related; that id is already taken by something the separate step owns. The ONLY edges you omit are ones whose "from" or "to" references one of THEIR ids specifically - every other edge from the input, between components you're keeping, must still be present in your output exactly as it was unless the architecture genuinely no longer calls for that specific connection. Dropping an edge between two components you both kept, for any reason other than a deliberate architectural change, is a mistake - when in doubt, keep it.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- Beyond the extended kinds mentioned above (which you never emit yourself), you may only use the five base component kinds (gateway, service, cache, database, queue) - don't invent another new one.
- For anything that still conceptually exists from the input, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing across a rework, not a new one. Only mint a new id for a component that's genuinely new.
- Keep the same top-level "id" and "name" - you are reworking this system, not renaming it.
- Preserve every existing edge between two components you're both keeping unless you have a specific architectural reason to remove it (the extended-kind carve-out above is the one narrow exception) - a rework that silently drops real connections produces a diagram that no longer reflects the actual system.
- At most ${MAX_BASE_COMPONENTS} components in your own output. If the holistic review would call for more, that's a sign to fold or reconsider something already there before adding, not to grow past the limit.
- Every trait still needs a rationale and a provenance. "stated" means the input model already had this value and you're keeping it because it's still correct - never mark something "stated" that you are choosing or changing yourself; that's "inferred" (derived from something else in the system) or "default" (your own reasonable choice, nothing in the system dictates it).
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

${STRUCTURAL_SELF_CHECK}

Output only the structured model. Do not add findings, recommendations, or commentary - a separate step decides what's wrong with the model you produce, not you.`;

export type { StructuredCallOptions as ReworkModelOptions };
export interface ReworkModelResult {
  model: SystemModel;
  raw: unknown;
  repaired: boolean;
}

/** A fix the user has already chosen to apply — see this file's own top comment. */
export interface PendingFixInput {
  componentId: string;
  findingTitle: string;
  fixLabel: string;
  fixTradeoff: string;
}

/**
 * A change the user asked for in chat — see this file's own top comment.
 * `request` is their exact words; `instruction` is the self-contained
 * restatement the chat step wrote (real component ids, references resolved).
 */
export interface PendingChangeInput {
  request: string;
  instruction: string;
}

export function formatPendingChanges(pendingChanges: PendingChangeInput[]): string {
  if (pendingChanges.length === 0) return "";
  const lines = pendingChanges
    .map((c, i) => `${i + 1}. The user asked: "${c.request}"\n   Instruction: ${c.instruction}`)
    .join("\n");
  return `\n\nThe user has also asked for these changes to the architecture in chat (oldest first; a later one overrides an earlier one where they conflict) — implement each one, in addition to your normal holistic review:\n${lines}`;
}

export function formatPendingFixes(pendingFixes: PendingFixInput[]): string {
  if (pendingFixes.length === 0) return "";
  const lines = pendingFixes
    .map((f) => `- On "${f.componentId}": ${f.fixLabel} (addressing: ${f.findingTitle}) — tradeoff: ${f.fixTradeoff}`)
    .join("\n");
  return `\n\nThe user has specifically chosen to apply these fixes — implement each one precisely, in addition to your normal holistic review:\n${lines}`;
}

/**
 * Enforces, in code, the one continuity rule REWORK_PROMPT already states
 * but the model isn't guaranteed to follow: "preserve every existing edge
 * between two components you're both keeping." Zod's own superRefine
 * (schema.ts) can't check this — it only ever sees the proposed output in
 * isolation, never the model being revised — so a repair-retry that patches
 * a badly degenerate first attempt just enough to satisfy every Zod rule,
 * without regenerating an actually complete answer, sails through as a
 * schema-valid "success" while silently discarding most of the input.
 * Confirmed live: exactly this happened on a real Re-simulate — a
 * catastrophically malformed first attempt got "repaired" into a
 * schema-valid model with a single edge total, missing almost the whole
 * previous architecture.
 *
 * Only BASE-kind components/edges are ever in scope: `result` (the base
 * call's own output) never contains an extended-kind component by design —
 * a real omission it OMITTED on purpose, not one it dropped — and an edge
 * to one is the revise step's to own, never this call's, so it's correctly
 * excluded from `baseIds` and therefore never flagged here.
 *
 * A component the result legitimately removed is exempt — "you're both
 * keeping" is false for it, so there's nothing to preserve, and choosing to
 * remove something is a real (if rare) holistic-review outcome, not this
 * bug. What's never legitimate is dropping the CONNECTION between two
 * components that are both still present under the same id.
 *
 * Exported for direct, fast unit tests — the full integration (that a
 * violation actually triggers a real repair-retry through
 * `runStructuredCall`) has its own separate test.
 */
export function checkNoDroppedEdges(input: SystemModel, result: SystemModel): string | null {
  const baseIds = new Set(input.components.filter((c) => !isExtendedComponent(c)).map((c) => c.id));
  const resultIds = new Set(result.components.map((c) => c.id));
  const kept = (id: string) => baseIds.has(id) && resultIds.has(id);

  const dropped = input.edges.filter(
    (e) => kept(e.from) && kept(e.to) && !result.edges.some((r) => r.from === e.from && r.to === e.to),
  );
  if (dropped.length === 0) return null;

  const list = dropped.map((e) => `"${e.from}" -> "${e.to}"`).join(", ");
  const noun = dropped.length === 1 ? "edge" : "edges";
  const them = dropped.length === 1 ? "it" : "them";
  return (
    `You dropped ${dropped.length} ${noun} between components you're keeping, without being asked to: ${list}. ` +
    `Every edge between two components you both kept must still be present exactly as it was — restore ${them}, ` +
    `unless the request specifically required removing ${them}.`
  );
}

export async function reworkModel(
  model: SystemModel,
  pendingFixes: PendingFixInput[] = [],
  pendingChanges: PendingChangeInput[] = [],
  options: StructuredCallOptions = {},
): Promise<ReworkModelResult> {
  const pendingContext = `${formatPendingFixes(pendingFixes)}${formatPendingChanges(pendingChanges)}`;
  const result = await runStructuredCall(
    REWORK_PROMPT,
    `Here is the current model:\n\n${JSON.stringify(model)}${pendingContext}`,
    SystemModelSchema,
    buildTool(),
    { maxRetries: 2, ...options, validateResult: (data) => checkNoDroppedEdges(model, data as SystemModel) },
    "reworkModel",
  );

  // Sequential, not parallel — this needs the FRESHLY reworked base
  // component ids (the base call above may have added/renamed/removed
  // some) to correctly wire the extended components back in. Previous
  // extended components come from the INPUT model, not the base rework's
  // own output — that output can never contain them (see REWORK_PROMPT).
  const previousExtended: Component[] = model.components.filter(isExtendedComponent);
  // A queued fix or a chat-requested change can target an extended component
  // ("add a fallback" on an external-dependency, "add a CDN") — and the base
  // call above is told to leave exactly those to this step, so this is the
  // ONLY place they get implemented. Passed as `additionalContext` so it
  // isn't silently ignored by a call that otherwise only sees "previous
  // extended components" + "current base topology". Empty when nothing is
  // queued, which is a no-op here exactly as it is on the base call.
  const extended = await reviseExtendedComponents(previousExtended, result.data, options, pendingContext);

  return {
    model: {
      ...result.data,
      components: [...result.data.components, ...extended.components],
      edges: [...result.data.edges, ...extended.edges],
      workload: { ...result.data.workload, users: model.workload.users, requests: model.workload.requests },
    },
    raw: result.raw,
    repaired: result.repaired,
  };
}
