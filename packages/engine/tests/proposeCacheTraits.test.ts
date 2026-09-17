/**
 * `proposeCacheTraits` against a fake Anthropic client — no network, no API
 * cost. Mirrors fromProse.test.ts's fake-client pattern. Unlike fromProse,
 * there's no repair-retry loop here — a malformed response throws, and the
 * caller (the web API route) is responsible for catching that and falling
 * back to fixes.ts's hardcoded defaults.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { proposeCacheTraits } from "../src/inference/proposeCacheTraits.js";
import { checkout } from "../models/reference.js";

const validProposalInput = {
  ttl: { rationale: "Order totals should reflect near-real-time pricing.", value: "short" },
  keyspaceSize: { rationale: "A small set of frequently-viewed orders dominates traffic.", value: "small" },
  hasStampedeProtection: { rationale: "Short TTL over a small keyspace needs coalescing to stay safe.", value: true },
};

const invalidProposalInput = {
  ...validProposalInput,
  ttl: { rationale: "", value: "short" }, // empty rationale fails schema validation
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "propose_cache_traits", input }],
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

describe("proposeCacheTraits", () => {
  it("returns a parsed proposal when the response validates", async () => {
    const client = fakeClient(toolUseResponse(validProposalInput));
    const result = await proposeCacheTraits(checkout, "db", { client });

    expect(result.ttl.value).toBe("short");
    expect(result.keyspaceSize.value).toBe("small");
    expect(result.hasStampedeProtection.value).toBe(true);
    expect(result.ttl.rationale.length).toBeGreaterThan(0);
  });

  it("throws (no repair retry) when the response fails validation", async () => {
    const client = fakeClient(toolUseResponse(invalidProposalInput));
    await expect(proposeCacheTraits(checkout, "db", { client })).rejects.toThrow();
  });

  it("throws when the model responds without calling the tool", async () => {
    const client = fakeClient(textOnlyResponse());
    await expect(proposeCacheTraits(checkout, "db", { client })).rejects.toThrow(
      /without calling the tool/i,
    );
  });

  it("throws when the target component isn't a database in this model", async () => {
    const client = fakeClient(toolUseResponse(validProposalInput));
    await expect(proposeCacheTraits(checkout, "svc", { client })).rejects.toThrow(
      /not a database/i,
    );
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(proposeCacheTraits(checkout, "db")).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
