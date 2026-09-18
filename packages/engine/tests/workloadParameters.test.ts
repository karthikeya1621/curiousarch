/**
 * `extractWorkloadParameters` against a fake Anthropic client — no
 * network, no API cost. Mirrors fromProse.test.ts's fake-client pattern:
 * both share `runStructuredCall`'s validate -> repair-retry -> give-up
 * state machine.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { extractWorkloadParameters } from "../src/inference/workloadParameters.js";

const validInput = {
  users: { included: true, tier: 100, target: 1_000_000 },
  requests: { included: false, tier: 1000, target: 1000 },
};

const invalidInput_offLadder = {
  users: { included: true, tier: 100, target: 1234 }, // not on the ladder
  requests: { included: false, tier: 1000, target: 1000 },
};

const invalidInput_noneIncluded = {
  users: { included: false, tier: 100, target: 100 },
  requests: { included: false, tier: 1000, target: 1000 },
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_workload_parameters", input }],
  } as unknown as Anthropic.Message;
}

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

describe("extractWorkloadParameters", () => {
  it("returns parsed parameters when the response validates", async () => {
    const client = fakeClient([toolUseResponse(validInput)]);
    const result = await extractWorkloadParameters("A movie booking system for 1M users", { client });

    expect(result.users.included).toBe(true);
    expect(result.users.tier).toBe(100);
    expect(result.users.target).toBe(1_000_000);
    expect(result.requests.included).toBe(false);
  });

  it("repairs once when the tier/target aren't on the closed ladder", async () => {
    const client = fakeClient([toolUseResponse(invalidInput_offLadder), toolUseResponse(validInput)]);
    const result = await extractWorkloadParameters("A movie booking system for 1M users", { client });

    expect(result.users.target).toBe(1_000_000);
  });

  it("repairs once when neither dimension is included", async () => {
    const client = fakeClient([toolUseResponse(invalidInput_noneIncluded), toolUseResponse(validInput)]);
    const result = await extractWorkloadParameters("A movie booking system for 1M users", { client });

    expect(result.users.included).toBe(true);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([
      toolUseResponse(invalidInput_offLadder),
      toolUseResponse(invalidInput_offLadder),
    ]);

    await expect(
      extractWorkloadParameters("A movie booking system for 1M users", { client }),
    ).rejects.toThrow(/still failed validation/i);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(extractWorkloadParameters("A movie booking system for 1M users")).rejects.toThrow(
        /API key/i,
      );
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
