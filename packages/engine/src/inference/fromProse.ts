/**
 * Prose in, `SystemModel` out.
 *
 * One LLM call using tool-use for structured output, Zod validation, one
 * repair retry if validation fails — per PLAN-0.2. The tool's input schema is
 * derived from `SystemModelSchema` rather than hand-duplicated, so the two
 * cannot drift out of sync.
 *
 * This function does not compute a single finding. It only produces the
 * model; `simulate()` in solver.ts is what decides what's wrong.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ParameterSchema, SystemModelSchema } from "./schema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { SystemModel } from "../types.ts";

const TOOL_NAME = "emit_system_model";
const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Recursively strips numeric bound keywords from a JSON Schema tree.
 *
 * Discovered live: with `strict: true` (constrained decoding), the API
 * rejects `exclusiveMinimum` outright ("For 'number' type, property
 * 'exclusiveMinimum' is not supported") — and had already rejected the
 * OpenAPI-style boolean form of the same keyword as invalid JSON Schema
 * draft 2020-12 before that. Constrained decoding apparently only grammars
 * structural keywords (type/properties/required/enum/items/anyOf), not
 * numeric ranges, at least for this API version. Rather than keep guessing
 * which numeric keyword is safe against a live, billed call, this drops all
 * of them from what's *sent to the model* — the actual bound (`.positive()`
 * on rps/callsPerRequest in schema.ts) is still enforced where it matters,
 * by SystemModelSchema.safeParse() on the returned tool call in fromProse,
 * same as the cycle/rationale checks that were never representable in JSON
 * Schema either way.
 */
function stripNumericBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripNumericBounds(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  delete obj.minimum;
  delete obj.maximum;
  delete obj.exclusiveMinimum;
  delete obj.exclusiveMaximum;
  for (const value of Object.values(obj)) stripNumericBounds(value);
}

/**
 * jsonSchema7, not openApi3: openApi3 emits the OpenAPI-style boolean
 * exclusiveMinimum/Maximum described above, which is also invalid JSON
 * Schema draft 2020-12 regardless of strict mode (confirmed against ajv's
 * 2020-12 meta-schema in tests/toolSchema.test.ts). $refStrategy "none"
 * avoids $ref/definitions. The custom cycle/rationale checks in
 * SystemModelSchema's superRefine aren't representable in JSON Schema
 * either way — they're enforced by the .parse() call in fromProse, not by
 * this.
 */
export function buildToolInputSchema(): Record<string, unknown> {
  // SystemModelSchema reuses the same ParameterSchema object across ~20
  // fields (maxRps, instances, queryTimeMs, ...). Inlining it at every
  // occurrence ($refStrategy "none") produced a schema strict mode's
  // compiled grammar rejected outright as too large — discovered live.
  // $refStrategy "root" alone fixed the size but pointed $ref at the first
  // inline occurrence's path (e.g. #/properties/components/.../id), which
  // the API also rejects live: "References must be defined under '$defs' or
  // 'definitions'". Passing `definitions` explicitly hoists ParameterSchema
  // into a real definitions block with a proper #/definitions/Parameter
  // $ref, satisfying both constraints.
  const schema = zodToJsonSchema(SystemModelSchema, {
    target: "jsonSchema7",
    $refStrategy: "root",
    definitions: { Parameter: ParameterSchema },
  }) as Record<string, unknown>;
  // zodToJsonSchema stamps a draft-07 $schema pointer even under the
  // jsonSchema7 target; the actual shape it emits validates fine against
  // 2020-12, but the stale pointer itself is worth not sending.
  delete schema.$schema;
  stripNumericBounds(schema);
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description:
      "Emit the inferred capacity model for the system described in the prompt.",
    // Without this, the schema is only a hint — observed live: the model
    // wrapped its answer in a spurious outer key ("model", once even
    // "parameter name") instead of matching the schema's top level exactly.
    // Every object in SystemModelSchema already has additionalProperties:
    // false and a full `required` list (Zod's default), which strict mode
    // requires — verified in tests/toolSchema.test.ts.
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

/**
 * Live latency for this call has been observed ranging ~4s-60s call to call
 * (same prompt, same model) — the tool schema is non-trivial and generation
 * length varies with how many components the model decides to emit. 90s
 * gives real headroom above the worst case seen without leaving a hung
 * request to run indefinitely on the SDK's own default.
 */
const DEFAULT_TIMEOUT_MS = 90_000;

export interface FromProseOptions {
  apiKey?: string;
  model?: string;
  /** Repair attempts after the first call. PLAN-0.2 specifies one. */
  maxRetries?: number;
  /** Per-request timeout in ms. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  client?: Anthropic;
}

export interface FromProseResult {
  model: SystemModel;
  /** The tool-call arguments before validation, for docs/inference-log.md. */
  raw: unknown;
  /** True if the first attempt failed validation and the retry succeeded. */
  repaired: boolean;
}

export async function fromProse(
  description: string,
  options: FromProseOptions = {},
): Promise<FromProseResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error(
      "fromProse requires an Anthropic API key. Set ANTHROPIC_API_KEY or pass { apiKey }.",
    );
  }

  const client = options.client ?? new Anthropic({ apiKey, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const model = options.model ?? DEFAULT_MODEL;
  const tool = buildTool();
  const maxRetries = options.maxRetries ?? 1;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: description },
  ];

  let lastError = "";
  let lastRaw: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages:
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "user",
                content:
                  `Your previous structured output did not validate: ${lastError}\n\n` +
                  "Call the tool again with a corrected model that fixes exactly this problem.",
              },
            ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      lastError = "The model responded without calling the tool.";
      lastRaw = response.content;
      if (process.env.FROMPROSE_DEBUG) {
        console.error(`[fromProse] attempt ${attempt}: no tool_use block. content:`, JSON.stringify(response.content));
      }
      continue;
    }

    if (process.env.FROMPROSE_DEBUG) {
      console.error(`[fromProse] attempt ${attempt}: raw tool input:`, JSON.stringify(toolUse.input));
    }

    const parsed = SystemModelSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return { model: parsed.data, raw: toolUse.input, repaired: attempt > 0 };
    }

    lastRaw = toolUse.input;
    lastError = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }

  const rawSnippet = JSON.stringify(lastRaw)?.slice(0, 500);
  throw new Error(
    `fromProse: structured output still failed validation after ${maxRetries} ` +
      `repair attempt(s). Last error: ${lastError}\nLast raw output (truncated): ${rawSnippet}`,
  );
}
