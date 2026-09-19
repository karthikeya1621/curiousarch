/**
 * Extracts workload.users/workload.requests from a prose description — a
 * genuinely separate structured call from `fromProse`'s topology
 * extraction, not a field bolted onto the same one.
 *
 * Discovered live: `SystemModelSchema` (components/edges) was already
 * close enough to strict mode's compiled-grammar size limit that there
 * was no room left to also ask for workload parameters in the same tool
 * call — confirmed by binary search, even a single flat 3-field object
 * pushed it over. This call is sized like `explainFix.ts`, confirmed
 * live to have real headroom, and its result is merged into the final
 * `SystemModel` in code (`fromProse.ts`), not asked of the topology call.
 *
 * Only `fromProse` needs this. `reworkModel` never does: the user sets a
 * new tier by moving a control, not by describing one — Re-simulate's
 * job is reworking the ARCHITECTURE for a tier that's already set, not
 * deciding the tier itself. `reworkModel.ts` carries the input model's
 * users/requests forward unchanged for exactly this reason.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runStructuredCall, UTILITY_MODEL, type StructuredCallOptions } from "./structuredCall.ts";
import { USER_TIERS, REQUEST_TIERS } from "../types.ts";

export { USER_TIERS, REQUEST_TIERS };

// A function, not a shared object — `users`/`requests` below must each
// get a FRESH object instance, or the reused identity gets $reffed (same
// gotcha as elsewhere in this package).
const dimensionSchema = () =>
  z.object({
    included: z.boolean(),
    tier: z.number(),
    target: z.number(),
  });

export const WorkloadParametersSchema = z
  .object({
    users: dimensionSchema(),
    requests: dimensionSchema(),
  })
  .superRefine((val, ctx) => {
    if (!val.users.included && !val.requests.included) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of users or requests must be included — every system has users, even if the description didn't say so.",
        path: [],
      });
    }
    function checkLadder(dimension: "users" | "requests", ladder: readonly number[]) {
      const param = val[dimension];
      if (!ladder.includes(param.tier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${dimension}.tier must be one of ${ladder.join(", ")} — got ${param.tier}.`,
          path: [dimension, "tier"],
        });
      }
      if (!ladder.includes(param.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${dimension}.target must be one of ${ladder.join(", ")} — got ${param.target}.`,
          path: [dimension, "target"],
        });
      }
    }
    checkLadder("users", USER_TIERS);
    checkLadder("requests", REQUEST_TIERS);
  });

export type WorkloadParameters = z.infer<typeof WorkloadParametersSchema>;

const TOOL_NAME = "emit_workload_parameters";

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(WorkloadParametersSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit this system's workload parameters (users and/or requests).",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

const EXTRACT_PROMPT = `You are reading a plain-English description of a distributed system to extract its workload parameters — this is a LEARNING TOOL, so whichever dimension(s) you include always starts small regardless of what the description says, and the description's own number is only ever recorded as a target to grow toward, never as the starting point.

You produce exactly two fields, "users" and "requests", each with "included" (is this dimension actually relevant to this system?), "tier" (the current rough step, a plain number), and "target" (the ambition, a plain number):
- Decide which dimension(s) the description actually establishes. "1M users" or any mention of people/accounts/customers -> include "users". "5M requests" or any mention of request/query/call volume or rate -> include "requests". Both mentioned -> include both. Neither clearly stated -> include "users" only, since every system has users even if the description didn't say so — at least one of the two must be included.
- For a dimension you include: tier is ALWAYS the lowest step of its ladder (100 for users, 1000 for requests) — never the number stated in the description, no matter how large. This is deliberate: the person learning starts small and raises it themselves to see what breaks. target is the closest ladder step to the number the description actually stated (e.g. "1M users" -> target 1000000); if no number was stated for a dimension you're including anyway, set target equal to tier.
- For a dimension you do NOT include: set included to false, and set both tier and target to that dimension's lowest ladder step.
- The users ladder is exactly: 100, 10000, 1000000, 100000000. The requests ladder is exactly: 1000, 100000, 10000000, 1000000000. Never a value outside the relevant list, even for a dimension you're not including.

Output only the structured parameters. Do not add commentary.`;

export async function extractWorkloadParameters(
  description: string,
  options: StructuredCallOptions = {},
): Promise<WorkloadParameters> {
  const result = await runStructuredCall(
    EXTRACT_PROMPT,
    description,
    WorkloadParametersSchema,
    buildTool(),
    // Snapping a stated number to the nearest ladder rung doesn't need
    // Sonnet — see structuredCall.ts's own comment on UTILITY_MODEL. An
    // explicit caller-supplied model (if any) still wins.
    { model: UTILITY_MODEL, ...options },
    "extractWorkloadParameters",
  );
  return result.data;
}
