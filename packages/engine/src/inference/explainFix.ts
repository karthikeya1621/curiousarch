/**
 * The AI call behind the web app's "Ask AI" affordance on a fix from
 * `identifyFailures.ts`: one sentence explaining why THIS specific fix
 * fits THIS specific system, deeper than the fix's own always-visible
 * `tradeoff`. Purely narrative and manually triggered — never fired
 * automatically on selection, never applied to the model. If it fails,
 * there's no fallback to compute — the caller just shows nothing extra,
 * since this was never load-bearing.
 *
 * Signature is plain strings (`componentId`/`fixLabel`/`findingCode`),
 * not tied to any particular finding/fix type — works unchanged whether
 * called with the old catalogue's `Fix`/`FindingCode` (dormant, see
 * `fixes.ts`) or the new `AiFinding`/`AiFix` from `identifyFailures.ts`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CHEAP_MODEL } from "./structuredCall.ts";
import type { SystemModel } from "../types.ts";

// A fresh, single-use z.object() (not a shared singleton) - same reason
// proposeCacheTraits.ts's proposedValueSchema is a function: no reused
// object identity in this schema, so no definitions-hoisting is needed.
const FixRationaleSchema = z.object({
  rationale: z
    .string()
    .min(1, "One short sentence: why this fix fits this specific system."),
});

export type FixRationale = z.infer<typeof FixRationaleSchema>;

const TOOL_NAME = "explain_fix";
// A one-sentence narrative rationale doesn't need Sonnet's full reasoning
// budget — see structuredCall.ts's own comment on CHEAP_MODEL.
const DEFAULT_MODEL = CHEAP_MODEL;
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

export interface ExplainFixOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  client?: Anthropic;
}

/** Single attempt, no repair retry — see this file's own top comment. */
export async function explainFix(
  model: SystemModel,
  componentId: string,
  fixLabel: string,
  findingCode: string,
  options: ExplainFixOptions = {},
): Promise<FixRationale> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error(
      "explainFix requires an Anthropic API key. Set ANTHROPIC_API_KEY or pass { apiKey }.",
    );
  }

  const component = model.components.find((c) => c.id === componentId);
  if (!component) {
    throw new Error(`explainFix: "${componentId}" is not a component in this model.`);
  }

  const client =
    options.client ?? new Anthropic({ apiKey, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const modelName = options.model ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 512,
    // Cached: every "Ask AI" click within a session reuses this exact
    // system prompt and tool schema (see structuredCall.ts's own comment).
    system: [{ type: "text", text: EXPLAIN_FIX_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [{ ...buildTool(), cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          `Component with the risk: "${componentId}" (${component.label}). ` +
          `Risk: ${findingCode}. Fix being applied: "${fixLabel}". Full system:\n\n` +
          `${JSON.stringify(model, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("explainFix: the model responded without calling the tool.");
  }

  return FixRationaleSchema.parse(toolUse.input);
}
