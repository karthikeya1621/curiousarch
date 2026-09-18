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
 */

import { SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import type { SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and its workload.users/workload.requests for context (each has "included": whether that dimension is relevant to this system, "tier": the current rough step on a small ladder, and "target": the original ambition for it). Some of it may already reflect real fixes that were applied (an added component, a corrected trait).

Reconsider the ARCHITECTURE holistically, the way an architect revisiting a system does: given where this system stands now (including its current scale), does it call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything exactly as it is if nothing more is warranted - do not change something just to have changed it. You are not deciding the workload parameters themselves - only the architecture that serves them.

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

export async function reworkModel(
  model: SystemModel,
  options: StructuredCallOptions = {},
): Promise<ReworkModelResult> {
  const result = await runStructuredCall(
    REWORK_PROMPT,
    // A short framing sentence before the JSON, not the bare object alone —
    // observed live: a user turn that's pure `{...}` with no lead-in
    // occasionally produced a degenerate first attempt (a model with only
    // the gateway, everything else silently dropped). The repair retry
    // recovers from this reliably now, but avoiding it in the first place
    // is cheaper than relying on a retry every time.
    `Here is the current model:\n\n${JSON.stringify(model, null, 2)}`,
    SystemModelSchema,
    buildTool(),
    // This input is larger and more complex than a typical prose
    // description (a full existing model, not a paragraph) — one extra
    // repair attempt of headroom over fromProse's default of 1, in case
    // the first attempt needs more than one correction round.
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
