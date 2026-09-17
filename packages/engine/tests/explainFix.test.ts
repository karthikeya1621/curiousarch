/**
 * `explainFix` against a fake Anthropic client — no network, no API cost.
 * Mirrors fromProse.test.ts's fake-client pattern. Single attempt, no
 * repair retry — a malformed response just throws.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { explainFix } from "../src/inference/explainFix.js";
import { checkout } from "../models/reference.js";

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "explain_fix", input }],
  } as unknown as Anthropic.Message;
}

function textOnlyResponse(): Anthropic.Message {
  return { content: [{ type: "text", text: "I have a question first." }] } as unknown as Anthropic.Message;
}

function fakeClient(response: Anthropic.Message): Anthropic {
  return {
    messages: { create: async () => response },
  } as unknown as Anthropic;
}

describe("explainFix", () => {
  it("returns a parsed rationale when the response validates", async () => {
    const client = fakeClient(
      toolUseResponse({
        rationale: "The order service has 8 instances but no circuit breaker, so a breaker here stops db issues from stalling every instance at once.",
      }),
    );
    const result = await explainFix(checkout, "svc", "Add a circuit breaker on svc's downstream calls", "CASCADING_FAILURE_RISK", { client });

    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("throws (no repair retry) when the response fails validation", async () => {
    const client = fakeClient(toolUseResponse({ rationale: "" }));
    await expect(
      explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client }),
    ).rejects.toThrow();
  });

  it("throws when the model responds without calling the tool", async () => {
    const client = fakeClient(textOnlyResponse());
    await expect(
      explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client }),
    ).rejects.toThrow(/without calling the tool/i);
  });

  it("throws when the target component isn't in this model", async () => {
    const client = fakeClient(toolUseResponse({ rationale: "..." }));
    await expect(
      explainFix(checkout, "nope", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client }),
    ).rejects.toThrow(/not a component/i);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK"),
      ).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
