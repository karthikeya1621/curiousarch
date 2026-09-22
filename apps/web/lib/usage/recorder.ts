import { createHash } from "node:crypto";
import type { AiCallRecord } from "@archsim/engine/server";
import { computeCost, PRICE_VERSION, type ModelPrice } from "./pricing";

/** What the user did that caused these AI calls. `build`/`rework`/`findings` are the three that fire the heavier calls. */
export type UsageAction = "build" | "rework" | "findings" | "chat" | "explain-fix";

export interface UsageContext {
  userId: string;
  /** Null only if the client sent none (see ids.ts). */
  projectId: string | null;
  actionId: string;
  action: UsageAction;
  /** Facts about the request the engine can't know — component counts, queue sizes, ... — copied onto every call row. */
  context: Record<string, unknown>;
}

/** Where rows go. The real one is Supabase (lib/usage/server.ts); tests use an in-memory one. */
export interface UsageSink {
  insertCall(row: Record<string, unknown>): Promise<void>;
  insertPayload(row: Record<string, unknown>): Promise<void>;
}

export interface RecorderDeps {
  sink: UsageSink;
  prices: Record<string, ModelPrice>;
  /** Keep the full prompt and response too (ai_call_payloads, short retention) — not just the metrics. */
  logPayloads: boolean;
  /**
   * Runs the write after the response has been sent (Next's `after`), so
   * logging never adds latency to the AI call. Defaults to fire-and-forget.
   */
  schedule?: (work: () => Promise<void>) => void;
  onError?: (err: unknown) => void;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Builds the `onCall` handler for one API request. Each AI call becomes an
 * `ai_calls` row (metrics, cost, outcome — kept indefinitely) and, when
 * enabled, an `ai_call_payloads` row (the full system prompt, messages and
 * output — purged on a schedule, see db/ai-usage.sql). Never throws and
 * never blocks: any failure to record is reported to `onError` and dropped,
 * because usage tracking must not be able to break the feature it observes.
 */
export function createUsageRecorder(ctx: UsageContext, deps: RecorderDeps): (record: AiCallRecord) => void {
  const schedule = deps.schedule ?? ((work) => void work());
  const onError = deps.onError ?? ((err) => console.error("[usage] failed to record an AI call:", err));

  return (record) => {
    try {
      const id = crypto.randomUUID();
      const { costUsd, cacheSavingsUsd } = computeCost(record.model, record.usage, deps.prices);
      const messagesJson = JSON.stringify(record.messages);
      const row = {
        id,
        user_id: ctx.userId,
        project_id: ctx.projectId,
        action_id: ctx.actionId,
        action: ctx.action,
        label: record.label,
        attempt: record.attempt,
        model: record.model,
        outcome: record.outcome,
        error: record.error?.slice(0, 2000) ?? null,
        stop_reason: record.stopReason,
        request_id: record.requestId ?? null,
        input_tokens: record.usage?.inputTokens ?? null,
        output_tokens: record.usage?.outputTokens ?? null,
        cache_creation_input_tokens: record.usage?.cacheCreationInputTokens ?? null,
        cache_read_input_tokens: record.usage?.cacheReadInputTokens ?? null,
        cost_usd: costUsd,
        cache_savings_usd: cacheSavingsUsd,
        price_version: PRICE_VERSION,
        duration_ms: record.durationMs,
        max_tokens: record.maxTokens,
        system_prompt_hash: hash(record.systemPrompt),
        request_chars: record.systemPrompt.length + messagesJson.length,
        context: ctx.context,
        created_at: new Date(record.startedAt).toISOString(),
      };
      const payload = deps.logPayloads
        ? {
            call_id: id,
            system_prompt: record.systemPrompt,
            messages: record.messages,
            output: record.output ?? null,
          }
        : null;

      schedule(async () => {
        try {
          await deps.sink.insertCall(row);
          // After the call row: the payload references it.
          if (payload) await deps.sink.insertPayload(payload);
        } catch (err) {
          onError(err);
        }
      });
    } catch (err) {
      onError(err);
    }
  };
}
