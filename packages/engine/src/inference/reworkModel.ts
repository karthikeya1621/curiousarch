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
 */

import { SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import type { SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and its workload.users/workload.requests for context (each has "included": whether that dimension is relevant to this system, "tier": the current rough step on a small ladder, and "target": the original ambition for it). Some of it may already reflect real fixes that were applied (an added component, a corrected trait). You may also be given a list of specific fixes the user has already chosen to apply.

If specific fixes are listed, implement each of them precisely first - they are already-decided choices, not suggestions to evaluate. Then reconsider the ARCHITECTURE holistically on top of that, the way an architect revisiting a system does: given where this system stands now (including its current scale), does it call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything else exactly as it is if nothing more is warranted - do not change something just to have changed it. You are not deciding the workload parameters themselves - only the architecture that serves them.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- You may only use the five existing component kinds (gateway, service, cache, database, queue) - reuse one of them with a descriptive label for a real technology (a message broker or CDN is usually best modelled as a queue or cache with the right label), don't invent a new kind.
- For anything that still conceptually exists from the input, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing across a rework, not a new one. Only mint a new id for a component that's genuinely new.
- Keep the same top-level "id" and "name" - you are reworking this system, not renaming it.
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

function formatPendingFixes(pendingFixes: PendingFixInput[]): string {
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
  return {
    model: {
      ...result.data,
      workload: { ...result.data.workload, users: model.workload.users, requests: model.workload.requests },
    },
    raw: result.raw,
    repaired: result.repaired,
  };
}
