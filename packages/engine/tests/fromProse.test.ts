/**
 * `fromProse` against a fake Anthropic client — no network, no API cost.
 *
 * This exercises the part of PLAN-0.2 that doesn't need a live model: the
 * validate -> repair-retry -> give-up state machine. The actual "does the LLM
 * produce a good model" question (0.2's real acceptance criterion, and 0.4)
 * still needs a live key; this only proves the harness around it is correct.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fromProse } from "../src/inference/fromProse.js";
import { simulate } from "../src/solver.js";

const validModelInput = {
  id: "toy",
  name: "Toy system",
  workload: { rps: 100 },
  components: [
    {
      id: "gw",
      label: "Gateway",
      kind: "gateway",
      maxRps: { rationale: "No limit stated; assumed default.", provenance: "default", value: 10_000, unit: "rps" },
    },
    {
      id: "svc",
      label: "Service",
      kind: "service",
      instances: { rationale: "Two instances stated.", provenance: "stated", value: 2, unit: "count" },
      concurrencyPerInstance: { rationale: "Default assumption.", provenance: "default", value: 25, unit: "count" },
      serviceTimeMs: { rationale: "Stated 30ms.", provenance: "stated", value: 30, unit: "ms" },
    },
  ],
  edges: [{ from: "gw", to: "svc", callsPerRequest: 1 }],
};

const invalidModelInput = {
  ...validModelInput,
  components: validModelInput.components.map((c) =>
    c.id === "svc" ? { ...c, serviceTimeMs: { ...c.serviceTimeMs, rationale: "" } } : c,
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
});
