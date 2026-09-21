/**
 * The AI call behind the web app's "Ask AI" affordance on a fix from
 * `identifyFailures.ts`: one sentence explaining why THIS specific fix
 * fits THIS specific system, deeper than the fix's own always-visible
 * `tradeoff`. Purely narrative and manually triggered — never fired
 * automatically on selection, never applied to the model. If it fails,
 * there's no fallback to compute — the caller just shows nothing extra,
 * since this was never load-bearing.
 *
 * Goes through `structuredCall.ts`'s `runStructuredCall` like every other
 * inference module, so it gets the same validation, one repair retry, and
 * prompt caching — it used to make its own bare `messages.create` call
 * (single attempt, a raw ZodError on a malformed answer) and accept
 * placeholder rationales the other calls reject.
 *
 * Signature is plain strings (`componentId`/`fixLabel`/`findingCode`),
 * not tied to the `AiFinding`/`AiFix` shape it's actually always called
 * with today — kept loose enough that it never needs to know about a
 * finding/fix type at all.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { rationaleSchema } from "./schema.ts";
import { runStructuredCall, UTILITY_MODEL, type StructuredCallOptions } from "./structuredCall.ts";
import type { SystemModel } from "../types.ts";

// A fresh, single-use z.object() (not a shared singleton) - same reason
// schema.ts's traitSchema() is a function: no reused object identity in
// this schema, so no definitions-hoisting is needed.
const FixRationaleSchema = z.object({
  rationale: rationaleSchema(),
});

export type FixRationale = z.infer<typeof FixRationaleSchema>;

const TOOL_NAME = "explain_fix";
// Tighter than the shared 90s default: nothing here is load-bearing enough
// to be worth waiting on. (The model choice — UTILITY_MODEL, not the
// reasoning model — is at the call site below.)
const DEFAULT_TIMEOUT_MS = 30_000;

const EXPLAIN_FIX_PROMPT = `You are an experienced architect. A real, computed risk was found in this system on one component, and a specific, already-decided fix is about to be applied to it - the fix itself is fixed and hand-chosen; you are not choosing it or evaluating whether it's right.

You are given: which component the risk is on, what the risk is, the fix being applied, and the rest of the system as JSON. Write ONE short sentence explaining why this particular fix is the right response for THIS system's specific context - reference something concrete from the system (its scale, its other components, their traits), not a generic definition of what the fix does in general.

Do not question the fix, do not propose a different fix, do not add any other commentary - only explain why it fits here. Output only the structured rationale.`;

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(FixRationaleSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Explain why this fix fits this specific system.",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

export type { StructuredCallOptions as ExplainFixOptions };

export async function explainFix(
  model: SystemModel,
  componentId: string,
  fixLabel: string,
  findingCode: string,
  options: StructuredCallOptions = {},
): Promise<FixRationale> {
  const component = model.components.find((c) => c.id === componentId);
  if (!component) {
    throw new Error(`explainFix: "${componentId}" is not a component in this model.`);
  }

  const result = await runStructuredCall(
    EXPLAIN_FIX_PROMPT,
    `Component with the risk: "${componentId}" (${component.label}). ` +
      `Risk: ${findingCode}. Fix being applied: "${fixLabel}". Full system:\n\n` +
      `${JSON.stringify(model)}`,
    FixRationaleSchema,
    buildTool(),
    // A one-sentence narration doesn't need the reasoning model, and is
    // bounded tighter than the shared 90s default — nothing here is
    // load-bearing enough to wait on. An explicit caller option wins.
    { model: UTILITY_MODEL, timeoutMs: DEFAULT_TIMEOUT_MS, ...options },
    "explainFix",
  );
  return result.data;
}
