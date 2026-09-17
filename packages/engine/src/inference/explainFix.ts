/**
 * The AI call behind every fix except `UNCACHED_DATABASE_AT_SCALE`'s
 * "add-cache" (see `proposeCacheTraits.ts` for that one). Those 6 fixes
 * are pure binary trait flips with nothing for an AI to decide — this
 * produces one sentence explaining why the fix fits THIS specific system,
 * purely narrative. Its output never reaches `Fix.apply`: it cannot change
 * the transform or a finding, only the words shown next to it. If it
 * fails, there's no fallback to compute — the caller just shows nothing
 * extra, since this was never load-bearing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
const DEFAULT_MODEL = "claude-sonnet-5";
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
    system: EXPLAIN_FIX_PROMPT,
    tools: [buildTool()],
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
