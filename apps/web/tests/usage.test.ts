/**
 * Server half of AI usage tracking: cost maths, the recorder that turns an
 * engine `AiCallRecord` into database rows, id parsing, and the outcome
 * route. The database is an in-memory sink — what's checked is what would be
 * written, and that recording can never break the call it observes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCallRecord } from "@archsim/engine/server";
import { computeCost, loadPrices, PRICE_VERSION } from "../lib/usage/pricing";
import { createUsageRecorder, type UsageContext, type UsageSink } from "../lib/usage/recorder";
import { isUuid, readUsageIds } from "../lib/usage/ids";

describe("computeCost", () => {
  const prices = loadPrices(undefined);
  const haiku = "claude-haiku-4-5-20251001";

  it("prices input, cache writes (1.25x), cache reads (0.1x) and output separately", () => {
    const { costUsd, cacheSavingsUsd } = computeCost(
      haiku,
      { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 2000, cacheReadInputTokens: 10_000 },
      prices,
    );
    // $1/M in, $5/M out: 1000*1e-6 + 2000*1.25e-6 + 10000*0.1e-6 + 500*5e-6
    expect(costUsd).toBeCloseTo(0.007, 9);
    // What the 10k cache-read tokens saved versus paying full input price for them.
    expect(cacheSavingsUsd).toBeCloseTo(0.009, 9);
  });

  it("is null — not a guess — for a model with no known price, or a call with no usage", () => {
    const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    expect(computeCost("claude-opus-5", usage, prices)).toEqual({ costUsd: null, cacheSavingsUsd: null });
    expect(computeCost(haiku, undefined, prices)).toEqual({ costUsd: null, cacheSavingsUsd: null });
  });

  it("prices both default tiers out of the box — the ones structuredCall.ts falls back to with no env override", () => {
    expect(prices["claude-sonnet-5"]).toBeDefined();
    expect(prices[haiku]).toBeDefined();
  });

  it("takes prices for other models from AI_MODEL_PRICES, ignoring malformed entries and bad JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const custom = loadPrices(
      JSON.stringify({
        "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 }, // overrides the built-in default
        "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 }, // adds one that has none
        broken: { inputPerMTok: "x" },
        negative: { inputPerMTok: -1, outputPerMTok: 1 },
      }),
    );
    expect(custom["claude-sonnet-5"]).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
    expect(custom["claude-opus-5"]).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
    expect(custom.broken).toBeUndefined();
    expect(custom.negative).toBeUndefined();
    expect(custom[haiku]).toBeDefined(); // defaults survive an override

    expect(loadPrices("{not json")[haiku]).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("usage ids", () => {
  const good = "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21";

  it("accepts UUIDs only", () => {
    expect(isUuid(good)).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(`${good}; drop table`)).toBe(false);
  });

  it("keeps a valid action/project id and replaces anything else — a request is always trackable, never trusted", () => {
    expect(readUsageIds({ actionId: good, projectId: good })).toEqual({ actionId: good, projectId: good });

    const fallback = readUsageIds({ actionId: "junk", projectId: "junk" });
    expect(isUuid(fallback.actionId)).toBe(true); // minted, so the call still groups as its own action
    expect(fallback.projectId).toBeNull();

    expect(isUuid(readUsageIds(null).actionId)).toBe(true);
  });
});

describe("createUsageRecorder", () => {
  const ctx: UsageContext = {
    userId: "user-1",
    projectId: "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21",
    actionId: "0a9f0d7e-2b1a-4c1e-9a55-0d3f5b7a1e99",
    action: "rework",
    context: { components: 5, pendingFixes: 2 },
  };

  const record = (overrides: Partial<AiCallRecord> = {}): AiCallRecord => ({
    label: "reworkModel",
    attempt: 0,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    systemPrompt: "SYSTEM PROMPT",
    messages: [{ role: "user", content: "hello" }],
    toolName: "emit_system_model",
    outcome: "ok",
    output: { id: "checkout" },
    stopReason: "tool_use",
    requestId: "req_1",
    usage: { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    startedAt: Date.parse("2026-09-22T10:00:00Z"),
    durationMs: 1234,
    ...overrides,
  });

  let calls: Record<string, unknown>[];
  let payloads: Record<string, unknown>[];
  let order: string[];
  let sink: UsageSink;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    calls = [];
    payloads = [];
    order = [];
    sink = {
      insertCall: async (row) => void (calls.push(row), order.push("call")),
      insertPayload: async (row) => void (payloads.push(row), order.push("payload")),
    };
  });

  const recorder = (deps: Partial<Parameters<typeof createUsageRecorder>[1]> = {}) =>
    createUsageRecorder(ctx, { sink, prices: loadPrices(undefined), logPayloads: true, ...deps });

  it("writes one row per call: attribution, model, outcome, tokens, cost, timing and request context", async () => {
    recorder()(record());
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      user_id: "user-1",
      project_id: ctx.projectId,
      action_id: ctx.actionId,
      action: "rework",
      label: "reworkModel",
      attempt: 0,
      model: "claude-haiku-4-5-20251001",
      outcome: "ok",
      stop_reason: "tool_use",
      request_id: "req_1",
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      price_version: PRICE_VERSION,
      duration_ms: 1234,
      max_tokens: 8192,
      context: { components: 5, pendingFixes: 2 },
      created_at: "2026-09-22T10:00:00.000Z",
    });
    expect(calls[0]!.cost_usd).toBeCloseTo(0.0035, 9); // 1000 in @ $1/M + 500 out @ $5/M
    expect(typeof calls[0]!.id).toBe("string");
    expect(calls[0]!.system_prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(calls[0]!.request_chars).toBeGreaterThan("SYSTEM PROMPT".length);
  });

  it("stores the full prompt and response in a separate payload row, written after the call it references", async () => {
    recorder()(record());
    await flush();

    expect(order).toEqual(["call", "payload"]);
    expect(payloads[0]).toEqual({
      call_id: calls[0]!.id,
      system_prompt: "SYSTEM PROMPT",
      messages: [{ role: "user", content: "hello" }],
      output: { id: "checkout" },
    });
  });

  it("keeps metrics only when payload logging is off", async () => {
    recorder({ logPayloads: false })(record());
    await flush();
    expect(calls).toHaveLength(1);
    expect(payloads).toEqual([]);
  });

  it("gives the same system prompt the same hash, and a different one a different hash — so a prompt change is visible", async () => {
    const log = recorder();
    log(record());
    log(record());
    log(record({ systemPrompt: "SYSTEM PROMPT v2" }));
    await flush();
    expect(calls[0]!.system_prompt_hash).toBe(calls[1]!.system_prompt_hash);
    expect(calls[0]!.system_prompt_hash).not.toBe(calls[2]!.system_prompt_hash);
  });

  it("records a failed attempt and a failed request too — they're billed (or attempted) either way", async () => {
    const log = recorder();
    log(record({ outcome: "invalid", error: "edges: Required" }));
    log(record({ outcome: "error", error: "connection reset", usage: undefined, stopReason: null, requestId: undefined }));
    await flush();

    expect(calls[0]).toMatchObject({ outcome: "invalid", error: "edges: Required" });
    expect(calls[1]).toMatchObject({ outcome: "error", input_tokens: null, cost_usd: null, request_id: null });
  });

  it("leaves cost null for a model with no configured price, but still stores the tokens to price later", async () => {
    recorder()(record({ model: "claude-opus-5" }));
    await flush();
    expect(calls[0]).toMatchObject({ cost_usd: null, cache_savings_usd: null, input_tokens: 1000, output_tokens: 500 });
  });

  it("hands the write to `schedule` (Next's after()) instead of doing it inline", async () => {
    const scheduled: (() => Promise<void>)[] = [];
    recorder({ schedule: (work) => scheduled.push(work) })(record());

    expect(calls).toHaveLength(0); // nothing written until the scheduler runs it
    await scheduled[0]!();
    expect(calls).toHaveLength(1);
  });

  it("never throws or blocks: a failing database is reported and dropped", async () => {
    const onError = vi.fn();
    const failing: UsageSink = {
      insertCall: async () => {
        throw new Error("db down");
      },
      insertPayload: async () => {},
    };
    expect(() => recorder({ sink: failing, onError })(record())).not.toThrow();
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "db down" }));
  });

  it("never throws on a malformed record either", () => {
    const onError = vi.fn();
    expect(() => recorder({ onError })({ ...record(), messages: undefined } as unknown as AiCallRecord)).not.toThrow();
    expect(onError).toHaveBeenCalled();
  });
});

// ---- the outcome route ----

const adminInsert = vi.fn();
const authState = { user: { id: "user-1" } as { id: string } | null, admin: true };
vi.mock("../lib/supabase/admin", () => ({
  getAdminClient: () => (authState.admin ? { from: (table: string) => ({ insert: (row: unknown) => adminInsert(table, row) }) } : null),
}));
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authState.user } }) } }),
}));

describe("POST /api/usage/outcome", () => {
  const actionId = "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21";
  const post = async (body: unknown) => {
    const { POST } = await import("../app/api/usage/outcome/route.ts");
    return POST(
      new Request("http://localhost/api/usage/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  };

  beforeEach(() => {
    adminInsert.mockReset().mockResolvedValue({ error: null });
    authState.user = { id: "user-1" };
    authState.admin = true;
  });

  it("records the reason against the signed-in user — never a user id from the request", async () => {
    const res = await post({ actionId, reason: "superseded", user_id: "someone-else" });
    expect(res.status).toBe(204);
    expect(adminInsert).toHaveBeenCalledWith("ai_action_outcomes", { user_id: "user-1", action_id: actionId, reason: "superseded" });
  });

  it.each([
    ["a non-uuid action id", { actionId: "x", reason: "superseded" }],
    ["an unknown reason", { actionId, reason: "because" }],
    ["a missing reason", { actionId }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(adminInsert).not.toHaveBeenCalled();
  });

  it("answers 204 and writes nothing when tracking is off or nobody is signed in", async () => {
    authState.admin = false;
    expect((await post({ actionId, reason: "withheld" })).status).toBe(204);
    authState.admin = true;
    authState.user = null;
    expect((await post({ actionId, reason: "withheld" })).status).toBe(204);
    expect(adminInsert).not.toHaveBeenCalled();
  });
});

// ---- startUsage: the route-facing wiring ----

describe("startUsage", () => {
  const actionId = "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21";
  const projectId = "0a9f0d7e-2b1a-4c1e-9a55-0d3f5b7a1e99";
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const aCall = {
    label: "chatWithProject:route",
    attempt: 0,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    systemPrompt: "S",
    messages: [{ role: "user", content: "hi" }],
    toolName: "t",
    outcome: "ok",
    stopReason: "tool_use",
    startedAt: 0,
    durationMs: 5,
  } as unknown as AiCallRecord;

  beforeEach(() => {
    adminInsert.mockReset().mockResolvedValue({ error: null });
    authState.user = { id: "user-1" };
    authState.admin = true;
    delete process.env.AI_USAGE_LOG_PAYLOADS;
  });

  it("returns an onCall that files each call under the signed-in user and the client's action/project ids", async () => {
    const { startUsage } = await import("../lib/usage/server");
    const usage = await startUsage({ actionId, projectId }, { action: "chat", context: { components: 3 } });

    usage.onCall!(aCall);
    await flush();

    const tables = adminInsert.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(["ai_calls", "ai_call_payloads"]);
    expect(adminInsert.mock.calls[0]![1]).toMatchObject({
      user_id: "user-1",
      project_id: projectId,
      action_id: actionId,
      action: "chat",
      context: { components: 3 },
    });
  });

  it("skips the payload table when AI_USAGE_LOG_PAYLOADS=false", async () => {
    process.env.AI_USAGE_LOG_PAYLOADS = "false";
    const { startUsage } = await import("../lib/usage/server");
    (await startUsage({}, { action: "chat" })).onCall!(aCall);
    await flush();
    expect(adminInsert.mock.calls.map((c) => c[0])).toEqual(["ai_calls"]);
  });

  it("turns tracking off — returning nothing to hand the engine — when there's no service key or no user", async () => {
    const { startUsage } = await import("../lib/usage/server");
    authState.admin = false;
    expect(await startUsage({}, { action: "chat" })).toEqual({});
    authState.admin = true;
    authState.user = null;
    expect(await startUsage({}, { action: "chat" })).toEqual({});
  });

  it("a database failure while recording doesn't surface to the caller", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    adminInsert.mockResolvedValue({ error: { message: "relation does not exist" } });
    const { startUsage } = await import("../lib/usage/server");
    const usage = await startUsage({}, { action: "chat" });
    expect(() => usage.onCall!(aCall)).not.toThrow();
    await flush();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
