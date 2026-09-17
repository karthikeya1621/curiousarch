/**
 * "Re-simulate": a full rebuild of the current system, seeded from its own
 * current state instead of typed prose. Same category of operation as
 * `fromProse` — produce a candidate `SystemModel` — and shares its exact
 * validated, retried, strict-mode-hardened call via
 * `runStructuredModelCall` (see fromProse.ts's own comment on why this is
 * shared rather than duplicated).
 *
 * Same load-bearing boundary as everywhere else in this package: this
 * produces a model, never a finding. Whatever the rework changes, the
 * pattern engine (`evaluatePatterns`/`simulate()`) is what decides what's
 * wrong with the result — exactly as it always has, on any other model.
 */

import { runStructuredModelCall } from "./fromProse.ts";
import type { FromProseOptions, FromProseResult } from "./fromProse.ts";
import type { SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and the workload scale. Some of it may already reflect real fixes that were applied (an added component, a corrected trait).

Reconsider it holistically, the way an architect revisiting a system does: does this system, as it stands now, call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything exactly as it is if nothing more is warranted - do not change something just to have changed it.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- You may only use the five existing component kinds (gateway, service, cache, database, queue).
- For anything that still conceptually exists from the input, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing across a rework, not a new one. Only mint a new id for a component that's genuinely new.
- Keep the same top-level "id" and "name" - you are reworking this system, not renaming it.
- Every trait still needs a rationale and a provenance. "stated" means the input model already had this value and you're keeping it because it's still correct - never mark something "stated" that you are choosing or changing yourself; that's "inferred" (derived from something else in the system) or "default" (your own reasonable choice, nothing in the system dictates it).
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

Output only the structured model. Do not add findings, recommendations, or commentary - the engine computes findings from the model you produce, not you.`;

export type { FromProseOptions as ReworkModelOptions, FromProseResult as ReworkModelResult };

export async function reworkModel(
  model: SystemModel,
  options: FromProseOptions = {},
): Promise<FromProseResult> {
  return runStructuredModelCall(
    REWORK_PROMPT,
    // A short framing sentence before the JSON, not the bare object alone —
    // observed live: a user turn that's pure `{...}` with no lead-in
    // occasionally produced a degenerate first attempt (a model with only
    // the gateway, everything else silently dropped). The repair retry
    // (see fromProse.ts's runStructuredModelCall) recovers from this
    // reliably now, but avoiding it in the first place is cheaper than
    // relying on a retry every time.
    `Here is the current model:\n\n${JSON.stringify(model, null, 2)}`,
    // This input is larger and more complex than a typical prose
    // description (a full existing model, not a paragraph) — one extra
    // repair attempt of headroom over fromProse's default of 1, in case
    // the first attempt needs more than one correction round.
    { maxRetries: 2, ...options },
    "reworkModel",
  );
}
