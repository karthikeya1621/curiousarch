/**
 * The shared core behind every structured-output AI call in this package —
 * `fromProse`, `reworkModel`, `identifyFailures`, `applyAiFix`. One LLM
 * call using tool-use, Zod validation against whatever schema the caller
 * passes, one repair retry on validation failure.
 *
 * Schema/tool-agnostic (originally lived inside fromProse.ts, hardcoded to
 * `SystemModelSchema`, before `identifyFailures`/`applyAiFix` needed the
 * exact same retry machinery for a different output shape). Extracted
 * rather than duplicated: this loop has already had multiple separate
 * live-discovered bugs fixed in it (the strict-mode JSON Schema gotchas
 * `fromProse.ts` documents, and the repair-retry-repairs-blind bug fixed
 * earlier this session) — every caller should get every fix, not just the
 * ones written after it existed.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export interface StructuredCallOptions {
  apiKey?: string;
  model?: string;
  /** Repair attempts after the first call. */
  maxRetries?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  client?: Anthropic;
}

export interface StructuredCallResult<T> {
  data: T;
  /** The tool-call arguments before validation, for docs/inference-log.md. */
  raw: unknown;
  /** True if the first attempt failed validation and the retry succeeded. */
  repaired: boolean;
}

const DEFAULT_MODEL = "claude-sonnet-5";
/**
 * For calls that don't need full reasoning quality — a mechanical
 * classification or a single narrative sentence, not judging an
 * architecture. Still a current-generation model, not a stale cheap one:
 * Haiku 4.5, not an older Haiku. Callers opt into this explicitly (see
 * workloadParameters.ts, chatWithProject.ts's route call, explainFix.ts) —
 * every call that actually reasons about the architecture's quality
 * (fromProse/reworkModel's topology, identifyFailures, applyAiFix,
 * chatWithProject's change-implementation call) keeps the default above.
 */
export const CHEAP_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * `label` only affects error-message text (which caller to blame in a
 * thrown error) and the `STRUCTURED_CALL_DEBUG` env var checked for
 * verbose logging.
 */
export async function runStructuredCall<T>(
  systemPrompt: string,
  userContent: string,
  schema: z.ZodType<T>,
  tool: Anthropic.Tool,
  options: StructuredCallOptions = {},
  label = "structuredCall",
): Promise<StructuredCallResult<T>> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error(
      `${label} requires an Anthropic API key. Set ANTHROPIC_API_KEY or pass { apiKey }.`,
    );
  }

  const client = options.client ?? new Anthropic({ apiKey, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const model = options.model ?? DEFAULT_MODEL;
  const maxRetries = options.maxRetries ?? 1;

  // Prompt caching: the system prompt and tool schema are identical across
  // every call this label makes (every identifyFailures call shares the
  // same instructions; every repair-retry attempt within one call reuses
  // them too), so marking both as cache breakpoints lets Anthropic skip
  // reprocessing that prefix on a cache hit — a large fraction of the cost
  // on a call whose actual per-request payload (the model/message) is
  // usually much smaller than its instructions. Two breakpoints, not one:
  // system and tools are separate segments in the request, and marking
  // only the tool doesn't reliably extend the cached range backward over
  // the system text before it.
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
  const cachedTool: Anthropic.Tool = { ...tool, cache_control: { type: "ephemeral" } };

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  let lastError = "";
  let lastRaw: unknown;
  /**
   * Set only when the previous attempt actually produced a tool_use block
   * (its id is required to build a valid assistant/tool_result turn pair
   * below). Left unset after a "no tool_use block" attempt, since there's
   * no prior tool call to reference — the repair message falls back to a
   * plain user turn in that case.
   */
  let lastToolUseId: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // See this file's own top comment: appending the repair instruction
      // as a second, consecutive plain "user" message — with no assistant
      // turn showing what the model actually output before — leaves the
      // model repairing blind, with no way to see its own prior (invalid)
      // answer, only the terse validation error. Anthropic's own
      // tool-result feedback pattern — an assistant turn with the exact
      // previous tool_use, followed by a user turn with a `tool_result`
      // block marked `is_error: true` — gives the model its own prior
      // output to correct against, not just a description of what was
      // wrong with it.
      if (lastToolUseId) {
        messages.push(
          { role: "assistant", content: [{ type: "tool_use", id: lastToolUseId, name: tool.name, input: lastRaw }] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: lastToolUseId,
                is_error: true,
                content: `Your previous structured output did not validate: ${lastError}\n\nCall the tool again with a corrected version that fixes exactly this problem.`,
              },
            ],
          },
        );
      } else {
        messages.push({
          role: "user",
          content:
            `Your previous response did not call the tool: ${lastError}\n\n` +
            "Call the tool with the structured output.",
        });
      }
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: cachedSystem,
      tools: [cachedTool],
      tool_choice: { type: "tool", name: tool.name },
      messages,
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      lastError = "The model responded without calling the tool.";
      lastRaw = response.content;
      lastToolUseId = undefined;
      if (process.env.STRUCTURED_CALL_DEBUG) {
        console.error(`[${label}] attempt ${attempt}: no tool_use block. content:`, JSON.stringify(response.content));
      }
      continue;
    }

    if (process.env.STRUCTURED_CALL_DEBUG) {
      console.error(`[${label}] attempt ${attempt}: raw tool input:`, JSON.stringify(toolUse.input));
    }

    const parsed = schema.safeParse(toolUse.input);
    if (parsed.success) {
      return { data: parsed.data, raw: toolUse.input, repaired: attempt > 0 };
    }

    lastRaw = toolUse.input;
    lastToolUseId = toolUse.id;
    lastError = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }

  const rawSnippet = JSON.stringify(lastRaw)?.slice(0, 500);
  throw new Error(
    `${label}: structured output still failed validation after ${maxRetries} ` +
      `repair attempt(s). Last error: ${lastError}\nLast raw output (truncated): ${rawSnippet}`,
  );
}
