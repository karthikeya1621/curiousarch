/**
 * `reworkModel` against a fake Anthropic client — no network, no API cost.
 * Mirrors fromProse.test.ts's fake-client pattern exactly, since both
 * share `runStructuredModelCall`'s validate -> repair-retry -> give-up
 * state machine. This only proves reworkModel wires that shared core
 * correctly (right prompt, right input content) — not that the AI
 * produces a sensible rework, which needs a live key.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { reworkModel } from "../src/inference/reworkModel.js";
import { checkout } from "../models/reference.js";
import { simulate } from "../src/solver.js";

const validReworkInput = {
  id: "checkout",
  name: "Checkout / order placement",
  workload: {
    scale: { rationale: "Still a single-region API.", provenance: "stated", value: "small" },
  },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: { rationale: "Already rate-limited.", provenance: "stated", value: true },
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instanceCount: { rationale: "Eight instances.", provenance: "stated", value: "multiple" },
      hasCircuitBreaker: { rationale: "Added a breaker on reconsideration.", provenance: "inferred", value: true },
    },
    {
      id: "db",
      label: "PostgreSQL (primary)",
      kind: "database",
      instanceCount: { rationale: "Two replicas.", provenance: "stated", value: "has-replicas" },
      writeVolume: { rationale: "Order inserts dominate.", provenance: "stated", value: "high" },
    },
  ],
  edges: [
    { from: "gw", to: "svc" },
    { from: "svc", to: "db" },
  ],
};

const invalidReworkInput = {
  ...validReworkInput,
  components: validReworkInput.components.map((c) =>
    c.id === "svc" ? { ...c, hasCircuitBreaker: { ...c.hasCircuitBreaker, rationale: "" } } : c,
  ),
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_system_model", input }],
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

describe("reworkModel", () => {
  it("returns a model unrepaired when the first attempt validates", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput)]);
    const result = await reworkModel(checkout, { client });

    expect(result.repaired).toBe(false);
    expect(() => simulate(result.model)).not.toThrow();
    // Confirms the rework kept the same id and preserved a component id
    // (svc) rather than the AI having renamed things.
    expect(result.model.id).toBe("checkout");
    expect(result.model.components.some((c) => c.id === "svc")).toBe(true);
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([
      toolUseResponse(invalidReworkInput),
      toolUseResponse(validReworkInput),
    ]);
    const result = await reworkModel(checkout, { client });

    expect(result.repaired).toBe(true);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    // maxRetries explicit here, decoupled from reworkModel's own internal
    // default (2, higher than fromProse's 1 — see reworkModel.ts) so this
    // test doesn't silently need a 3rd canned response if that default
    // ever changes again.
    const client = fakeClient([
      toolUseResponse(invalidReworkInput),
      toolUseResponse(invalidReworkInput),
    ]);

    await expect(reworkModel(checkout, { client, maxRetries: 1 })).rejects.toThrow(
      /still failed validation/i,
    );
  });

  it("defaults to 2 repair retries — more headroom than fromProse's 1, given a larger input", async () => {
    const client = fakeClient([
      toolUseResponse(invalidReworkInput),
      toolUseResponse(invalidReworkInput),
      toolUseResponse(validReworkInput),
    ]);

    const result = await reworkModel(checkout, { client });
    expect(result.repaired).toBe(true);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(reworkModel(checkout)).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
