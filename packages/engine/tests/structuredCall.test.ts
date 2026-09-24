/**
 * The `onCall` usage hook on `runStructuredCall` — against a fake Anthropic
 * client, no network. What matters: exactly one record per API request
 * (a repair retry is its own billed request, and so is a failed one), the
 * token counts and request id reach the record, and a broken logger can
 * never fail the call it's observing.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runStructuredCall, type AiCallRecord } from "../src/inference/structuredCall.js";

const Schema = z.object({ answer: z.string().min(1) });
const tool = {
  name: "emit_answer",
  description: "x",
  input_schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
} as unknown as Anthropic.Tool;

const usage = {
  input_tokens: 120,
  output_tokens: 45,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 800,
};

function toolResponse(input: unknown, extra: Record<string, unknown> = {}): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: "emit_answer", input }],
    stop_reason: "tool_use",
    usage,
    _request_id: "req_abc",
    ...extra,
  } as unknown as Anthropic.Message;
}

function fakeClient(steps: (Anthropic.Message | Error)[]): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const step = steps[call++];
        if (!step) throw new Error("fakeClient: out of responses");
        if (step instanceof Error) throw step;
        return step;
      },
    },
  } as unknown as Anthropic;
}

async function run(steps: (Anthropic.Message | Error)[], onCall?: (r: AiCallRecord) => void, maxRetries = 1) {
  return runStructuredCall("SYSTEM", "the question", Schema, tool, { client: fakeClient(steps), onCall, maxRetries }, "test:label");
}

describe("runStructuredCall onCall", () => {
  it("emits one ok record carrying usage, request id, prompts and output", async () => {
    const records: AiCallRecord[] = [];
    await run([toolResponse({ answer: "hi" })], (r) => records.push(r));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      label: "test:label",
      attempt: 0,
      outcome: "ok",
      toolName: "emit_answer",
      stopReason: "tool_use",
      requestId: "req_abc",
      systemPrompt: "SYSTEM",
      output: { answer: "hi" },
      maxTokens: 8192,
      usage: { inputTokens: 120, outputTokens: 45, cacheCreationInputTokens: 10, cacheReadInputTokens: 800 },
    });
    expect(records[0]!.messages).toEqual([{ role: "user", content: "the question" }]);
    expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits a record per attempt — a failed validation is billed, so it's recorded, then the repair", async () => {
    const records: AiCallRecord[] = [];
    const result = await run([toolResponse({ answer: "" }), toolResponse({ answer: "fixed" })], (r) => records.push(r));

    expect(result.repaired).toBe(true);
    expect(records.map((r) => [r.attempt, r.outcome])).toEqual([
      [0, "invalid"],
      [1, "ok"],
    ]);
    expect(records[0]!.error).toMatch(/answer/);
    // Each record snapshots the messages AS SENT: the repair attempt includes the failed turn, the first doesn't.
    expect(records[0]!.messages).toHaveLength(1);
    expect(records[1]!.messages.length).toBeGreaterThan(1);
  });

  it("records a response that never called the tool", async () => {
    const records: AiCallRecord[] = [];
    const noTool = { content: [{ type: "text", text: "sorry" }], stop_reason: "end_turn", usage } as unknown as Anthropic.Message;
    await run([noTool, toolResponse({ answer: "ok" })], (r) => records.push(r));

    expect(records[0]).toMatchObject({ outcome: "no-tool", stopReason: "end_turn", usage: { inputTokens: 120 } });
    expect(records[0]!.output).toEqual([{ type: "text", text: "sorry" }]);
  });

  it("records a truncated response by its stop reason", async () => {
    const records: AiCallRecord[] = [];
    await run([toolResponse({ answer: "" }, { stop_reason: "max_tokens" }), toolResponse({ answer: "ok" })], (r) =>
      records.push(r),
    );
    expect(records[0]!.stopReason).toBe("max_tokens");
  });

  it("records a failed request (no usage known) and still throws it", async () => {
    const records: AiCallRecord[] = [];
    await expect(run([new Error("connection reset")], (r) => records.push(r))).rejects.toThrow(/connection reset/);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: "error", error: "connection reset" });
    expect(records[0]!.usage).toBeUndefined();
  });

  it("never lets a throwing logger fail the call", async () => {
    const result = await run([toolResponse({ answer: "fine" })], () => {
      throw new Error("logger is down");
    });
    expect(result.data).toEqual({ answer: "fine" });
  });

  it("is a no-op when no onCall is given", async () => {
    const result = await run([toolResponse({ answer: "fine" })]);
    expect(result.data.answer).toBe("fine");
  });
});

describe("runStructuredCall validateResult", () => {
  // Not tied to any particular caller's invariant (reworkModel.ts's own
  // "no dropped edges" check has its own dedicated test) — this only proves
  // the generic wiring: a schema-valid result validateResult objects to is
  // billed and repaired exactly like a Zod failure, not a separate path.
  const rejectShort = (data: unknown) => {
    const answer = (data as { answer: string }).answer;
    return answer.length < 3 ? `"${answer}" is too short` : null;
  };

  it("accepts a result validateResult has nothing to say about", async () => {
    const result = await runStructuredCall("SYSTEM", "q", Schema, tool, { client: fakeClient([toolResponse({ answer: "long enough" })]), validateResult: rejectShort }, "t");
    expect(result.data.answer).toBe("long enough");
    expect(result.repaired).toBe(false);
  });

  it("bills and records a validateResult rejection the same way as a Zod failure — outcome 'invalid', with its message as the error", async () => {
    const records: AiCallRecord[] = [];
    const result = await runStructuredCall(
      "SYSTEM",
      "q",
      Schema,
      tool,
      {
        client: fakeClient([toolResponse({ answer: "no" }), toolResponse({ answer: "yes now" })]),
        validateResult: rejectShort,
        onCall: (r) => records.push(r),
      },
      "t",
    );

    expect(result.data.answer).toBe("yes now");
    expect(result.repaired).toBe(true);
    expect(records.map((r) => [r.attempt, r.outcome])).toEqual([
      [0, "invalid"],
      [1, "ok"],
    ]);
    expect(records[0]!.error).toBe('"no" is too short');
  });

  it("feeds validateResult's message back as real repair-retry context — the same tool_use/tool_result echo a Zod failure gets", async () => {
    const seenMessages: unknown[] = [];
    const client = fakeClient([toolResponse({ answer: "no" }), toolResponse({ answer: "yes now" })]);
    const wrapped = {
      messages: {
        create: async (params: unknown) => {
          seenMessages.push((params as { messages: unknown }).messages);
          return (client as unknown as { messages: { create: (p: unknown) => unknown } }).messages.create(params);
        },
      },
    } as unknown as Anthropic;

    await runStructuredCall("SYSTEM", "q", Schema, tool, { client: wrapped, validateResult: rejectShort }, "t");

    const repairTurn = (seenMessages[1] as { role: string; content: unknown }[])[2]!;
    expect(repairTurn.role).toBe("user");
    expect(JSON.stringify(repairTurn.content)).toContain("is too short");
  });

  it("still throws after exhausting retries when validateResult never accepts the result", async () => {
    await expect(
      runStructuredCall(
        "SYSTEM",
        "q",
        Schema,
        tool,
        { client: fakeClient([toolResponse({ answer: "no" }), toolResponse({ answer: "no" })]), validateResult: rejectShort, maxRetries: 1 },
        "t",
      ),
    ).rejects.toThrow(/too short/);
  });

  it("never lets validateResult itself crash the call — an exception from it propagates as a normal thrown error, not a silent pass", async () => {
    // Documents current behavior rather than prescribing it: unlike onCall
    // (explicitly swallowed — see structuredCall.ts), validateResult is
    // part of deciding whether the result is USABLE, so a bug in it failing
    // loud (the call rejects) is more honest than silently treating a
    // crashing check as "no problem found."
    await expect(
      runStructuredCall(
        "SYSTEM",
        "q",
        Schema,
        tool,
        {
          client: fakeClient([toolResponse({ answer: "fine" })]),
          validateResult: () => {
            throw new Error("checker bug");
          },
        },
        "t",
      ),
    ).rejects.toThrow(/checker bug/);
  });
});

describe("runStructuredCall normalizeOutput", () => {
  const call = (
    steps: (Anthropic.Message | Error)[],
    normalizeOutput: (input: unknown) => unknown,
    onCall?: (r: AiCallRecord) => void,
    onCreate?: (params: unknown) => void,
  ) => {
    const inner = fakeClient(steps);
    const client = {
      messages: {
        create: async (params: unknown) => {
          onCreate?.(params);
          return (inner as unknown as { messages: { create: (p: unknown) => unknown } }).messages.create(params);
        },
      },
    } as unknown as Anthropic;
    return runStructuredCall("SYSTEM", "q", Schema, tool, { client, normalizeOutput, onCall, maxRetries: 1 }, "t");
  };
  const fixEmpty = (input: unknown) => {
    const o = input as { answer: string };
    return o.answer === "" ? { answer: "filled in" } : input;
  };

  it("fixes an otherwise-invalid output BEFORE validation, so it costs no repair retry", async () => {
    let requests = 0;
    const result = await call([toolResponse({ answer: "" })], fixEmpty, undefined, () => requests++);
    expect(result.data.answer).toBe("filled in");
    expect(result.repaired).toBe(false);
    expect(requests).toBe(1);
  });

  it("records what the model ACTUALLY said, not the normalized value", async () => {
    const records: AiCallRecord[] = [];
    await call([toolResponse({ answer: "" })], fixEmpty, (r) => records.push(r));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: "ok", output: { answer: "" } });
  });

  it("echoes the NORMALIZED value on a repair retry, so error paths index into what the model is shown", async () => {
    const seen: { messages: { role: string; content: unknown }[] }[] = [];
    let n = 0;
    // First attempt: the model said "original", the normalizer turns it into
    // something invalid. Second attempt is left alone.
    const result = await call(
      [toolResponse({ answer: "original" }), toolResponse({ answer: "fixed" })],
      (input) => (n++ === 0 ? { answer: "" } : input),
      undefined,
      (params) => seen.push(params as never),
    );
    expect(result.data.answer).toBe("fixed");
    const echoed = JSON.stringify(seen[1]!.messages[1]!.content);
    expect(echoed).toContain('"answer":""'); // what was validated — and what the error paths refer to
    expect(echoed).not.toContain("original");
  });

  it("falls back to the model's original output if the normalizer throws — it must never fail a call", async () => {
    const result = await call([toolResponse({ answer: "fine" })], () => {
      throw new Error("normalizer bug");
    });
    expect(result.data.answer).toBe("fine");
  });

  it("does nothing when not given", async () => {
    const result = await run([toolResponse({ answer: "plain" })]);
    expect(result.data.answer).toBe("plain");
  });
});
