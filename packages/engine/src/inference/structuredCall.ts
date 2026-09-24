/**
 * The shared core behind every structured-output AI call in this package —
 * `fromProse`, `reworkModel`, `identifyFailures`, `explainFix`, chat. One LLM
 * call using tool-use, Zod validation against whatever schema the caller
 * passes, one repair retry on validation failure.
 *
 * Schema/tool-agnostic (originally lived inside fromProse.ts, hardcoded to
 * `SystemModelSchema`, before `identifyFailures` and the rest needed the
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
  /**
   * Prior conversation turns, prepended before the new user turn — the
   * only caller that sets this today is chatWithProject.ts, for genuine
   * multi-turn memory. Every other caller (fromProse, reworkModel,
   * identifyFailures, explainFix) is a one-shot call and simply never
   * sets it, so this is a no-op for them.
   */
  history?: Anthropic.MessageParam[];
  /**
   * Called once per API request (including repair retries and failed
   * requests) — see `AiCallRecord`. Purely observational: it can't change
   * the call, and if it throws the error is swallowed, so a broken logger
   * can never fail an AI call. Every inference function forwards `options`
   * to each `runStructuredCall` it makes, so setting this once on a public
   * entry point (`reworkModel`, `fromProse`, ...) observes all of its calls.
   */
  onCall?: (record: AiCallRecord) => void;
  /**
   * An extra check run AFTER `schema` itself validates, for an invariant
   * Zod can't express because it needs something Zod never sees: the input
   * this call is REVISING, not just the proposed output in isolation (e.g.
   * reworkModel.ts's own "did this drop an edge between two components it
   * kept" check, which needs the ORIGINAL model to answer). Return a
   * description of the problem to treat it exactly like a Zod validation
   * failure — a real, billed repair-retry, the description fed back to the
   * model the same way a Zod error would be; return null/undefined when the
   * result is fine.
   *
   * Exists because a schema-valid result can still be substantively wrong
   * in a way schema.ts's own superRefine has no way to catch — confirmed
   * live: a repair-retry once satisfied every Zod rule by patching a
   * catastrophically degenerate first attempt (a single component, one
   * edge) just enough to pass, rather than regenerating a real answer,
   * silently discarding almost the entire input model. That result was
   * schema-valid and shipped as "success."
   *
   * Typed `unknown`, not the call's own generic result type — this
   * interface isn't itself generic (every caller across the codebase
   * shares this one type), so `runStructuredCall<T>` calls it with its own
   * already-validated `T` and the one caller that sets this (reworkModel.ts)
   * narrows it back with a cast it can make safely, since it's the one that
   * knows which schema this options object is actually paired with.
   */
  validateResult?: (data: unknown) => string | null | undefined;
  /**
   * Rewrites the tool arguments BEFORE schema validation — for a mistake the
   * caller can undo deterministically, so it doesn't cost a billed repair
   * retry. reworkModel.ts uses it to drop edges that point at components it
   * was told it isn't allowed to reference: exactly what the prompt asks the
   * model to leave out, done in code instead of re-asked for.
   *
   * What's validated, echoed back on a repair retry, and returned as `raw` is
   * the NORMALIZED value, so every validation error's path (`edges.3.to`)
   * indexes into what the model is shown; `AiCallRecord.output` keeps the
   * model's original, since that's what it actually said. If it throws, the
   * original is used unchanged — a buggy normalizer must not fail a call.
   */
  normalizeOutput?: (input: unknown) => unknown;
}

/**
 * One API request made by `runStructuredCall` — a repair retry is its own
 * record, since it is its own billed request. Handed to
 * `StructuredCallOptions.onCall` so a caller can log usage without this
 * package knowing anything about where (a database, a file) or for whom.
 */
export interface AiCallRecord {
  /** Which inference step made the call (`fromProse`, `reworkModel`, `chatWithProject:route`, ...). */
  label: string;
  /** 0 for the first request, 1+ for a repair retry. */
  attempt: number;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  /** The messages exactly as sent on this attempt (a repair attempt includes the failed turn). */
  messages: Anthropic.MessageParam[];
  toolName: string;
  /**
   * ok: the tool output validated. invalid: it came back but failed schema
   * validation (a retry may follow). no-tool: the model never called the
   * tool. error: the request itself failed (network, timeout, API error) —
   * no usage is known for these.
   */
  outcome: "ok" | "invalid" | "no-tool" | "error";
  /** The validation failure, or the request error message. */
  error?: string;
  /** The tool arguments (ok/invalid), or the raw response content (no-tool). */
  output?: unknown;
  stopReason: string | null;
  /** Anthropic's request id, for support — absent on a client-injected fake. */
  requestId?: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  startedAt: number;
  durationMs: number;
}

export interface StructuredCallResult<T> {
  data: T;
  /** The tool-call arguments before validation, for docs/inference-log.md. */
  raw: unknown;
  /** True if the first attempt failed validation and the retry succeeded. */
  repaired: boolean;
}

/**
 * Named by PURPOSE, not cost or speed — two tiers of what a call actually
 * needs, each overridable via env var for testing a different model
 * without touching code (set in .env.local, restart the dev server). An
 * explicit `options.model` on any individual call (see runStructuredCall
 * below) still wins over both.
 *
 * Deliberately vendor-neutral names, not ANTHROPIC_*: today this only
 * ever reaches Anthropic's API (the client below is always
 * `new Anthropic(...)`), so pointing this at a non-Claude model id will
 * fail — swapping the actual provider needs a real abstraction layer
 * (a different client, different tool-use/response shapes), not built
 * here. The naming just avoids a rename later if that layer gets built.
 */
// AI_REASONING_MODEL — judges the architecture: decides findings, topology,
// how to implement a fix or a chat-requested change. Everything this
// product's actual value depends on getting right.
const REASONING_MODEL = process.env.AI_REASONING_MODEL || "claude-sonnet-5";
/**
 * AI_UTILITY_MODEL — everything else: a mechanical classification (is
 * this chat message a question or a change request?), snapping a stated
 * number to the nearest ladder rung, or narrating one sentence of "why
 * this fix fits." Never a call that decides what's wrong with a system or
 * how to change it (see workloadParameters.ts, chatWithProject.ts's route
 * call, explainFix.ts for where this is actually used). Still a
 * current-generation model, not a stale cheap one: Haiku 4.5, not an
 * older Haiku.
 */
export const UTILITY_MODEL = process.env.AI_UTILITY_MODEL || "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * `label` only affects error-message text (which caller to blame in a
 * thrown error) and the `STRUCTURED_CALL_DEBUG` env var checked for
 * verbose logging.
 */
/**
 * Shared by every structured call. Recorded on each `AiCallRecord` too, so
 * "did this call hit the ceiling" is answerable from a stored row alone.
 * See the comment on the request below for why it's this high.
 */
const MAX_OUTPUT_TOKENS = 8192;

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
  const model = options.model ?? REASONING_MODEL;
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
    ...(options.history ?? []),
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

    const startedAt = Date.now();
    const emit = (partial: Pick<AiCallRecord, "outcome"> & Partial<AiCallRecord>) => {
      if (!options.onCall) return;
      try {
        options.onCall({
          label,
          attempt,
          model,
          maxTokens: MAX_OUTPUT_TOKENS,
          systemPrompt,
          // A copy: `messages` grows on the next attempt's repair turn.
          messages: [...messages],
          toolName: tool.name,
          stopReason: null,
          startedAt,
          durationMs: Date.now() - startedAt,
          ...partial,
        });
      } catch {
        // Observational only — never let a logger fail the call.
      }
    };

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        // Found live, once the 7 extended component kinds made genuinely
        // large systems (15-20+ components, each with several trait
        // objects and rationale strings) reachable: 4096 truncated the
        // response mid-generation on a large `reworkModel` call, which
        // then failed validation with "edges: Required; workload:
        // Required" — not a bad answer, an incomplete one. Raised with
        // headroom rather than tuned to the exact case that broke, since
        // the whole point of adding more kinds is more components per
        // system, and every structured call in this file shares this one
        // constant.
        max_tokens: MAX_OUTPUT_TOKENS,
        system: cachedSystem,
        tools: [cachedTool],
        tool_choice: { type: "tool", name: tool.name },
        messages,
      });
    } catch (err) {
      emit({
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
        requestId: (err as { requestID?: string | null } | undefined)?.requestID ?? null,
      });
      throw err;
    }
    const usage = response.usage
      ? {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        }
      : undefined;
    const responseMeta = {
      stopReason: response.stop_reason ?? null,
      requestId: (response as { _request_id?: string | null })._request_id ?? null,
      usage,
    };

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      lastError = "The model responded without calling the tool.";
      emit({ outcome: "no-tool", error: lastError, output: response.content, ...responseMeta });
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

    let candidate: unknown = toolUse.input;
    if (options.normalizeOutput) {
      try {
        candidate = options.normalizeOutput(toolUse.input);
      } catch {
        candidate = toolUse.input;
      }
    }
    const parsed = schema.safeParse(candidate);
    if (parsed.success) {
      const resultProblem = options.validateResult?.(parsed.data);
      if (!resultProblem) {
        emit({ outcome: "ok", output: toolUse.input, ...responseMeta });
        return { data: parsed.data, raw: candidate, repaired: attempt > 0 };
      }
      // Schema-valid, but validateResult says it's still wrong — billed and
      // repaired exactly like a Zod failure below (same emit, same
      // tool_use/tool_result echo next iteration), not a separate path.
      lastRaw = candidate;
      lastToolUseId = toolUse.id;
      lastError = resultProblem;
      emit({ outcome: "invalid", error: lastError, output: toolUse.input, ...responseMeta });
      continue;
    }

    lastRaw = candidate;
    lastToolUseId = toolUse.id;
    lastError = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    emit({ outcome: "invalid", error: lastError, output: toolUse.input, ...responseMeta });
  }

  const rawSnippet = JSON.stringify(lastRaw)?.slice(0, 500);
  throw new Error(
    `${label}: structured output still failed validation after ${maxRetries} ` +
      `repair attempt(s). Last error: ${lastError}\nLast raw output (truncated): ${rawSnippet}`,
  );
}
