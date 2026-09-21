/**
 * `explainFix` against a fake Anthropic client — no network, no API cost.
 * Mirrors fromProse.test.ts's fake-client pattern. Goes through the shared
 * `runStructuredCall`, so a malformed answer gets one repair retry before
 * it throws — same as every other inference module.
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

/** Returns each response in turn, repeating the last one if the caller asks for more. */
function fakeClient(...responses: Anthropic.Message[]): Anthropic {
  let call = 0;
  return {
    messages: { create: async () => responses[Math.min(call++, responses.length - 1)] },
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

  it("throws once the repair retry also fails validation", async () => {
    const client = fakeClient(toolUseResponse({ rationale: "" }));
    await expect(
      explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client }),
    ).rejects.toThrow(/still failed validation/i);
  });

  it("recovers when the first answer is bad but the repair retry is good", async () => {
    const client = fakeClient(
      toolUseResponse({ rationale: "" }),
      toolUseResponse({ rationale: "A breaker here keeps a slow database from stalling all eight service instances at once." }),
    );
    const result = await explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client });
    expect(result.rationale).toMatch(/breaker/);
  });

  it("rejects a throwaway placeholder rationale, the same as a trait's rationale does", async () => {
    // Non-empty and passes the old `.min(1)`, but is no explanation at all.
    const client = fakeClient(toolUseResponse({ rationale: "placeholder" }));
    await expect(
      explainFix(checkout, "svc", "Add a circuit breaker", "CASCADING_FAILURE_RISK", { client }),
    ).rejects.toThrow(/placeholder/i);
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
