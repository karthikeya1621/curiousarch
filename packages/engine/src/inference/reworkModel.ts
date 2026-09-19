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

import { SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { isExtendedComponent, reviseExtendedComponents } from "./extendedComponents.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { MAX_BASE_COMPONENTS, type Component, type SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and its workload.users/workload.requests for context (each has "included": whether that dimension is relevant to this system, "tier": the current rough step on a small ladder, and "target": the original ambition for it). Some of it may already reflect real fixes that were applied (an added component, a corrected trait). You may also be given a list of specific fixes the user has already chosen to apply.

If specific fixes are listed, implement each of them precisely first - they are already-decided choices, not suggestions to evaluate. Then reconsider the ARCHITECTURE holistically on top of that, the way an architect revisiting a system does: given where this system stands now (including its current scale), does it call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything else exactly as it is if nothing more is warranted - do not change something just to have changed it. You are not deciding the workload parameters themselves - only the architecture that serves them.

Some components in the model may be of an EXTENDED kind (external-dependency, load-balancer, message-broker, cdn, object-storage, scheduled-job, config-store) - these are shown to you for context only and are reworked by a separate step, never by you. Your own output must never include one of these kinds, and their ids are OFF LIMITS to you entirely - never reuse one of their ids for a component of your own, even a base-kind one that seems related; that id is already taken by something the separate step owns. The ONLY edges you omit are ones whose "from" or "to" references one of THEIR ids specifically - every other edge from the input, between components you're keeping, must still be present in your output exactly as it was unless the architecture genuinely no longer calls for that specific connection. Dropping an edge between two components you both kept, for any reason other than a deliberate architectural change, is a mistake - when in doubt, keep it.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- Beyond the extended kinds mentioned above (which you never emit yourself), you may only use the five base component kinds (gateway, service, cache, database, queue) - don't invent another new one.
- For anything that still conceptually exists from the input, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing across a rework, not a new one. Only mint a new id for a component that's genuinely new.
- Keep the same top-level "id" and "name" - you are reworking this system, not renaming it.
- Preserve every existing edge between two components you're both keeping unless you have a specific architectural reason to remove it (the extended-kind carve-out above is the one narrow exception) - a rework that silently drops real connections produces a diagram that no longer reflects the actual system.
- At most ${MAX_BASE_COMPONENTS} components in your own output. If the holistic review would call for more, that's a sign to fold or reconsider something already there before adding, not to grow past the limit.
- Every trait still needs a rationale and a provenance. "stated" means the input model already had this value and you're keeping it because it's still correct - never mark something "stated" that you are choosing or changing yourself; that's "inferred" (derived from something else in the system) or "default" (your own reasonable choice, nothing in the system dictates it).
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

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

export function formatPendingFixes(pendingFixes: PendingFixInput[]): string {
  if (pendingFixes.length === 0) return "";
  const lines = pendingFixes
    .map((f) => `- On "${f.componentId}": ${f.fixLabel} (addressing: ${f.findingTitle}) — tradeoff: ${f.fixTradeoff}`)
    .join("\n");
  return `\n\nThe user has specifically chosen to apply these fixes — implement each one precisely, in addition to your normal holistic review:\n${lines}`;
}

export async function reworkModel(
  model: SystemModel,
  pendingFixes: PendingFixInput[] = [],
  options: StructuredCallOptions = {},
): Promise<ReworkModelResult> {
  const result = await runStructuredCall(
    REWORK_PROMPT,
    `Here is the current model:\n\n${JSON.stringify(model, null, 2)}${formatPendingFixes(pendingFixes)}`,
    SystemModelSchema,
    buildTool(),
    { maxRetries: 2, ...options },
    "reworkModel",
  );

  // Sequential, not parallel — this needs the FRESHLY reworked base
  // component ids (the base call above may have added/renamed/removed
  // some) to correctly wire the extended components back in. Previous
  // extended components come from the INPUT model, not the base rework's
  // own output — that output can never contain them (see REWORK_PROMPT).
  const previousExtended: Component[] = model.components.filter(isExtendedComponent);
  // A queued fix can target an extended component (e.g. "add a fallback"
  // on an external-dependency) — passed through as the same
  // `additionalContext` mechanism chatWithProject.ts uses for a chat
  // message, so it isn't silently ignored by a call that only otherwise
  // sees "previous extended components" + "current base topology".
  // `formatPendingFixes` returns "" for an empty list, which is a no-op
  // here exactly as it is on the base call above.
  const extended = await reviseExtendedComponents(previousExtended, result.data, options, formatPendingFixes(pendingFixes));

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
