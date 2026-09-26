/**
 * Does the drafted topology cover every part the description names? The AI's
 * first draft sometimes leaves one out: a description that fanned match events out
 * to analytics, anti-cheat and notification subscribers came back with a broker
 * that only had a publisher, in 2 of 2 builds. The topology schema has no room for
 * an extra field (it sits at the strict-mode grammar limit — see workloadParameters.ts),
 * so the check is a small separate call, the same idea as the per-kind decisions of
 * `proposeExtendedComponents`: the AI lists each named part and says which
 * component covers it, and code only checks the list is consistent.
 *
 * Returns the names of BASE-kind parts the draft does not cover. The caller then
 * asks for one more draft that includes them. A failed check never fails a build.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EXTENDED_KINDS } from "./extendedComponents.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";

const PartSchema = z.object({
  name: z.string().min(1),
  owner: z.enum(["base", "extended", "not-built"]),
  componentId: z.string(),
  reason: z.string().min(1),
});
const CoverageSchema = z.object({ parts: z.array(PartSchema) });
export type CoveragePart = z.infer<typeof PartSchema>;

const TOOL_NAME = "emit_coverage";

const COVERAGE_PROMPT = `You are checking that a drafted architecture model covers every part a description names.

You are given the description and the drafted model's components (id, kind, label). List every distinct PART the description names or clearly implies as something that would be built or run: a service, a store, a cache, a queue, a job, an external system, a subscriber, a server fleet. For each part give:
- name: the part as the description words it.
- owner: "extended" when it is one of these kinds, which a separate step models and you must not judge here: ${EXTENDED_KINDS.join(", ")}. "not-built" ONLY for something that is never built or run: users or players, a metric, a property or policy of another part (a rate limit, a timeout), the scale. "base" for everything else that would be built or run - a service, worker, subscriber, consumer, gateway, cache, database or queue. A named subscriber, consumer or worker that reacts to events is "base": if the draft has nothing for it, that is exactly a part the draft leaves out, so it is "base" with an empty componentId - never "not-built".
- componentId: for a "base" part, the id of the drafted component that covers it, or "" when nothing in the draft covers it. A part that naturally lives inside a broader component counts as covered by that component - give its id. For an "extended" or "not-built" part, "".
- reason: one short line - what covers it, or why nothing does.

Be honest, not generous: "" means the draft really leaves the part out. Do not invent parts the description does not name.

Output only the structured list.`;

function buildTool(): Anthropic.Tool {
  const schema = zodToJsonSchema(CoverageSchema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: TOOL_NAME,
    description: "Emit every part the description names, and which drafted component covers it.",
    strict: true,
    input_schema: schema as Anthropic.Tool.InputSchema,
  };
}

/** Consistency only: a base part's componentId is "" or an id of the draft. */
export function checkCoverageIds(parts: CoveragePart[], knownIds: ReadonlySet<string>): string | null {
  const bad = parts.filter((p) => p.componentId !== "" && !knownIds.has(p.componentId)).map((p) => `"${p.name}" -> "${p.componentId}"`);
  return bad.length > 0 ? `componentId must be "" or the id of a drafted component; unknown ids: ${bad.join(", ")}.` : null;
}

/** The names of base parts nothing in the draft covers. Empty when the check could not run. */
export async function findUncoveredParts(
  description: string,
  components: { id: string; kind: string; label: string }[],
  options: StructuredCallOptions = {},
): Promise<string[]> {
  try {
    const known = new Set(components.map((c) => c.id));
    const result = await runStructuredCall(
      COVERAGE_PROMPT,
      `Description:\n${description}\n\nDrafted components:\n${JSON.stringify(components.map((c) => ({ id: c.id, kind: c.kind, label: c.label })))}`,
      CoverageSchema,
      buildTool(),
      {
        maxRetries: 1,
        ...options,
        validateResult: (data) => checkCoverageIds((data as { parts: CoveragePart[] }).parts, known),
      },
      "coverageCheck",
    );
    return result.data.parts.filter((p) => p.owner === "base" && p.componentId === "").map((p) => p.name);
  } catch {
    // A check that couldn't run is not a reason to fail the build.
    return [];
  }
}

export function buildCoverageToolInputSchema(): Record<string, unknown> {
  return buildTool().input_schema as Record<string, unknown>;
}
