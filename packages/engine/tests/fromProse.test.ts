/**
 * `fromProse` against a fake Anthropic client — no network, no API cost.
 *
 * This exercises the part that doesn't need a live model: the validate ->
 * repair-retry -> give-up state machine. The actual "does the LLM produce a
 * sane rough model" question still needs a live key; this only proves the
 * harness around it is correct.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fromProse } from "../src/inference/fromProse.js";
import { simulate } from "../src/solver.js";

const validModelInput = {
  id: "toy",
  name: "Toy system",
  workload: {
    scale: { rationale: "No scale stated; assumed default.", provenance: "default", value: "medium" },
  },
  components: [
    {
      id: "gw",
      label: "Gateway",
      kind: "gateway",
      hasRateLimiting: { rationale: "No limit stated; assumed default.", provenance: "default", value: false },
    },
    {
      id: "svc",
      label: "Service",
      kind: "service",
      instanceCount: { rationale: "Two instances stated.", provenance: "stated", value: "multiple" },
      hasCircuitBreaker: { rationale: "Default assumption.", provenance: "default", value: false },
    },
  ],
  edges: [{ from: "gw", to: "svc" }],
};

const invalidModelInput = {
  ...validModelInput,
  components: validModelInput.components.map((c) =>
    c.id === "svc" ? { ...c, hasCircuitBreaker: { ...c.hasCircuitBreaker, rationale: "" } } : c,
  ),
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_system_model", input }],
  } as unknown as Anthropic.Message;
}

function textOnlyResponse(): Anthropic.Message {
  return { content: [{ type: "text", text: "I have a question first." }] } as unknown as Anthropic.Message;
}

/** A fake Anthropic client returning one canned response per call, in order. */
function fakeClient(responses: Anthropic.Message[]): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const response = responses[call];
        call++;
        if (!response) throw new Error("fakeClient: no more canned responses");
        return response;
      },
    },
  } as unknown as Anthropic;
}

describe("fromProse", () => {
  it("returns a model unrepaired when the first attempt validates", async () => {
    const client = fakeClient([toolUseResponse(validModelInput)]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(false);
    expect(() => simulate(result.model)).not.toThrow();
    expect(result.model.id).toBe("toy");
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([
      toolUseResponse(invalidModelInput),
      toolUseResponse(validModelInput),
    ]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(true);
    expect(result.model.id).toBe("toy");
  });

  it("treats a response with no tool_use block as a failed attempt, not a crash", async () => {
    const client = fakeClient([textOnlyResponse(), toolUseResponse(validModelInput)]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(true);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([
      toolUseResponse(invalidModelInput),
      toolUseResponse(invalidModelInput),
    ]);

    await expect(fromProse("a toy system", { client })).rejects.toThrow(
      /still failed validation/i,
    );
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(fromProse("a toy system")).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("respects maxRetries: 0 by giving up after the first failure", async () => {
    const client = fakeClient([toolUseResponse(invalidModelInput)]);
    await expect(
      fromProse("a toy system", { client, maxRetries: 0 }),
    ).rejects.toThrow(/after 0 repair attempt/i);
  });

  it("gives the repair attempt its own previous tool call to correct, not just an error string", async () => {
    // Discovered live (reworkModel, same shared retry loop): appending the
    // repair instruction as a second consecutive plain "user" message, with
    // no assistant turn showing what the model actually output before,
    // left it repairing blind — on a large input it reconstructed something
    // even MORE broken than the original rather than a precise fix. The fix
    // is Anthropic's own tool-result feedback pattern: an assistant turn
    // with the exact previous tool_use, then a user turn with a
    // `tool_result` block. This test inspects the actual second
    // `messages.create` call to confirm that shape, not just the outcome.
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (args: unknown) => {
          calls.push(args);
          return calls.length === 1 ? toolUseResponse(invalidModelInput) : toolUseResponse(validModelInput);
        },
      },
    } as unknown as Anthropic;

    await fromProse("a toy system", { client });

    expect(calls).toHaveLength(2);
    const secondCallMessages = (calls[1] as { messages: Anthropic.MessageParam[] }).messages;

    // [user: original prose, assistant: the invalid tool_use, user: tool_result with the error]
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[0]!.role).toBe("user");

    const assistantTurn = secondCallMessages[1]!;
    expect(assistantTurn.role).toBe("assistant");
    const assistantContent = assistantTurn.content as Anthropic.ToolUseBlockParam[];
    expect(assistantContent[0]!.type).toBe("tool_use");
    expect(assistantContent[0]!.id).toBe("call_1"); // the id from the first (invalid) response
    expect(assistantContent[0]!.input).toEqual(invalidModelInput);

    const repairTurn = secondCallMessages[2]!;
    expect(repairTurn.role).toBe("user");
    const repairContent = repairTurn.content as Anthropic.ToolResultBlockParam[];
    expect(repairContent[0]!.type).toBe("tool_result");
    expect(repairContent[0]!.tool_use_id).toBe("call_1");
    expect(repairContent[0]!.is_error).toBe(true);
    expect(String(repairContent[0]!.content)).toMatch(/did not validate/i);
  });
});
