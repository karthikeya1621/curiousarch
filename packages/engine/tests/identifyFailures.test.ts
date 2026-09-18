/**
 * `identifyFailures` against a fake Anthropic client — no network, no API
 * cost. Mirrors fromProse.test.ts's fake-client pattern: shares
 * `runStructuredCall`'s validate -> repair-retry -> give-up state machine.
 * This only proves the harness is wired correctly — not that the AI
 * produces good findings, which needs a live key.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { identifyFailures } from "../src/inference/identifyFailures.js";
import { checkout } from "../models/reference.js";

const validFindingsInput = {
  findings: [
    {
      code: "CASCADING_FAILURE_RISK",
      severity: "critical",
      componentId: "db",
      title: "No circuit breaker before the database",
      explanation: "If the database slows down, every request piles up waiting on it since nothing stops calls from reaching it.",
      fixes: [
        { id: "add-circuit-breaker", label: "Add a circuit breaker on the order service", tradeoff: "Failures surface as fast errors instead of hangs, which callers need to handle." },
      ],
    },
  ],
};

const emptyFindingsInput = { findings: [] };

const invalidFindingsInput = {
  findings: [
    {
      code: "CASCADING_FAILURE_RISK",
      severity: "critical",
      componentId: "db",
      title: "No circuit breaker before the database",
      explanation: "",
      fixes: [],
    },
  ],
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_failures", input }],
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

describe("identifyFailures", () => {
  it("returns parsed findings when the response validates", async () => {
    const client = fakeClient([toolUseResponse(validFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("CASCADING_FAILURE_RISK");
    expect(findings[0]!.fixes).toHaveLength(1);
  });

  it("accepts an empty findings list — a healthy system reports nothing wrong", async () => {
    const client = fakeClient([toolUseResponse(emptyFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toEqual([]);
  });

  it("repairs once when a finding is missing its explanation/fixes", async () => {
    const client = fakeClient([toolUseResponse(invalidFindingsInput), toolUseResponse(validFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toHaveLength(1);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([toolUseResponse(invalidFindingsInput), toolUseResponse(invalidFindingsInput)]);

    await expect(identifyFailures(checkout, { client })).rejects.toThrow(/still failed validation/i);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(identifyFailures(checkout)).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
