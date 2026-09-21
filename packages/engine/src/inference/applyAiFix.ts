/**
 * Applies one AI-suggested fix (from `identifyFailures.ts`) to the model.
 * Same category of operation as `fromProse`/`reworkModel` — produce a
 * candidate `SystemModel` — reusing the exact same topology schema/tool
 * (`schema.ts`'s `SystemModelSchema`, `fromProse.ts`'s `buildTool`) since
 * this is the identical "produce a whole updated topology" shape, just
 * seeded from a specific fix instead of prose or a general reconsideration.
 *
 * The fix itself (which finding, which remedy) is already decided by the
 * time this runs — the AI's only job here is to genuinely implement it,
 * not to evaluate or choose it. Like `reworkModel`, `workload.users`/
 * `workload.requests` are carried forward unchanged: applying a fix never
 * changes the user-set scale parameters, only the architecture.
 */

import { SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import type { AiFinding, AiFix, SystemModel } from "../types.ts";

const APPLY_FIX_PROMPT = `You are implementing a SPECIFIC, already-decided architectural fix on an existing system - you are not deciding whether to apply it, evaluating whether it's right, or choosing a different one. You will be told which finding it addresses and exactly what the fix is; make the concrete change needed to genuinely implement it, nothing more.

You will be given: the finding this fix addresses (its code, title, and explanation), the fix itself (its label and tradeoff), and the current model as JSON.

Modify the model to implement the fix - flip the relevant trait(s), and/or add, remove, or rewire components as the fix actually requires. Everything else about the system should stay exactly as it was unless the fix specifically requires a change to it - do not use this as an opportunity to reconsider the whole system.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- You may only use the five existing component kinds (gateway, service, cache, database, queue) - reuse one of them with a descriptive label for a real technology (a message broker or CDN is usually best modelled as a queue or cache with the right label), don't invent a new kind.
- For anything that still conceptually exists, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing, not a new one. Only mint a new id for a component this specific fix genuinely adds.
- Keep the same top-level "id" and "name".
- Every trait needs a rationale and a provenance. A value you are changing specifically to implement this fix is "inferred" (derived from applying the fix) - never "stated". "stated" is only for something that was already true and you're leaving unchanged.
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

Output only the structured model. Do not add findings, recommendations, or commentary.`;

export interface ApplyAiFixResult {
  model: SystemModel;
  raw: unknown;
  repaired: boolean;
}

export async function applyAiFix(
  model: SystemModel,
  finding: AiFinding,
  fix: AiFix,
  options: StructuredCallOptions = {},
): Promise<ApplyAiFixResult> {
  const content =
    `Finding: ${finding.code} — ${finding.title}\n${finding.explanation}\nOn component: "${finding.componentId}"\n\n` +
    `Fix to apply: "${fix.label}"\nTradeoff: ${fix.tradeoff}\n\n` +
    `Current model:\n\n${JSON.stringify(model)}`;

  const result = await runStructuredCall(
    APPLY_FIX_PROMPT,
    content,
    SystemModelSchema,
    buildTool(),
    options,
    "applyAiFix",
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
