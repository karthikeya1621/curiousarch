/**
 * The web app's only source of findings: an AI call given the current
 * model, not a pattern match against one. This is the explicit, informed
 * product decision behind this file: "fully AI-generated, no need
 * verification... it should think how a human senior architect thinks" —
 * made after seeing the concrete downside (the Gemini-fabrication incident
 * CONTEXT.md documents under "Why the pivot") and choosing it anyway. The
 * deterministic pattern-matching engine this superseded (`patterns.ts`/
 * `solver.ts`/`whatif.ts`/`fixes.ts`) has since been deleted outright —
 * see git history for its final form.
 *
 * Called again after every model change (a fresh build, a rework, a fix
 * applied) — there's no separate "recompute" step; asking the AI is the
 * only recompute there is.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import type { AiFinding, SystemModel } from "../types.ts";

const AiFixSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tradeoff: z.string().min(1, "What this costs — money, complexity, or risk. Never omitted."),
});

const AiFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["critical", "warning"]),
  componentId: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1, "One or two plain sentences. No jargon — this is a learning tool."),
  fixes: z.array(AiFixSchema).min(1),
});

const IdentifyFailuresResponseSchema = z.object({
  findings: z.array(AiFindingSchema),
});

const TOOL_NAME = "emit_failures";

const IDENTIFY_FAILURES_PROMPT = `You are a senior software architect reviewing a system design for real, concrete risks - the way you would in an actual design review, not a checklist exercise.

You are given the system as JSON: its components, their categorical traits (booleans and small categories, never precise numbers), the edges between them, and its workload (users and/or requests, each a rough scale rather than an exact number).

For each REAL risk you find, report:
- code: a short SCREAMING_SNAKE_CASE identifier. Reuse a well-known name if it genuinely fits (SINGLE_POINT_OF_FAILURE, THUNDERING_HERD_RISK, CASCADING_FAILURE_RISK, UNBOUNDED_ADMISSION, QUEUE_NO_DEAD_LETTER, FIXED_SCALING_AT_SCALE, UNCACHED_DATABASE_AT_SCALE, EXTERNAL_DEPENDENCY_NO_FALLBACK, LB_NO_HEALTH_CHECKS) or invent a new one if the risk is real but doesn't match any of those - these are a starting vocabulary, not an exhaustive list. Think like an architect, not a lookup table.
- severity: "critical" (this will actually break something) or "warning" (a real risk, not yet a proven failure). Don't mark everything critical - that trains people to ignore critical.
- componentId: which component (by its id in the JSON) this risk is on.
- title: a short, plain label for the risk.
- explanation: ONE OR TWO SHORT SENTENCES in plain language, as if explaining it to someone learning system design for the first time. No unexplained jargon. Say what could actually go wrong, concretely, referencing this specific system - not a generic definition of the risk category.
- fixes: one or two concrete remediations, each with an id (a short kebab-case slug, unique within this finding), a label (what to do, plainly), and a tradeoff (what it costs - money, complexity, or a new risk - stated honestly in one sentence).

Only report a risk you can point to something CONCRETE in the model for - a specific trait, a specific topology shape, a specific combination of the two. Don't invent a risk that isn't actually grounded in what's in front of you, and don't pad the list to look thorough. If the system is genuinely healthy at its current scale, say so by returning an empty findings list rather than manufacturing something to report.

Output only the structured findings list. Do not add any other commentary.`;

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(IdentifyFailuresResponseSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit the failure points identified for this system.",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

export async function identifyFailures(
  model: SystemModel,
  options: StructuredCallOptions = {},
): Promise<AiFinding[]> {
  const result = await runStructuredCall(
    IDENTIFY_FAILURES_PROMPT,
    JSON.stringify(model, null, 2),
    IdentifyFailuresResponseSchema,
    buildTool(),
    options,
    "identifyFailures",
  );
  return result.data.findings;
}
