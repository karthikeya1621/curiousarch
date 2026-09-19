/**
 * `applyAiFix` against a fake Anthropic client — no network, no API cost.
 * Mirrors fromProse.test.ts's fake-client pattern, since both share
 * `runStructuredCall`'s validate -> repair-retry -> give-up state machine
 * and the same topology schema.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { applyAiFix } from "../src/inference/applyAiFix.js";
import { checkout } from "../models/reference.js";
import type { AiFinding, AiFix, SystemModel } from "../src/types.js";

const finding: AiFinding = {
  code: "CASCADING_FAILURE_RISK",
  severity: "critical",
  componentId: "db",
  title: "No circuit breaker before the database",
  explanation: "If the database slows down, requests pile up with nothing to stop them.",
  fixes: [],
};

const fix: AiFix = {
  id: "add-circuit-breaker",
  label: "Add a circuit breaker on the order service",
  tradeoff: "Failures surface as fast errors instead of hangs.",
};

const validAppliedModel = {
  id: "checkout",
  name: "Checkout / order placement",
  workload: {},
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: { rationale: "Requests pass through a rate-limited API gateway.", provenance: "stated", value: true },
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instanceCount: { rationale: "Eight instances.", provenance: "stated", value: "multiple" },
      hasCircuitBreaker: { rationale: "Added to implement the fix.", provenance: "inferred", value: true },
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

const invalidAppliedModel = {
  ...validAppliedModel,
  components: validAppliedModel.components.map((c) =>
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

describe("applyAiFix", () => {
  it("returns the updated model unrepaired when the first attempt validates", async () => {
    const client = fakeClient([toolUseResponse(validAppliedModel)]);
    const result = await applyAiFix(checkout, finding, fix, { client });

    expect(result.repaired).toBe(false);
    const svc = result.model.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.hasCircuitBreaker.value).toBe(true);
    expect(svc.hasCircuitBreaker.provenance).toBe("inferred");
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([toolUseResponse(invalidAppliedModel), toolUseResponse(validAppliedModel)]);
    const result = await applyAiFix(checkout, finding, fix, { client });

    expect(result.repaired).toBe(true);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([toolUseResponse(invalidAppliedModel), toolUseResponse(invalidAppliedModel)]);

    await expect(applyAiFix(checkout, finding, fix, { client })).rejects.toThrow(/still failed validation/i);
  });

  it("carries workload.users/requests forward unchanged", async () => {
    const withParameters: SystemModel = {
      ...checkout,
      workload: {
        ...checkout.workload,
        users: { included: true, tier: 10_000, target: 1_000_000 },
      },
    };
    const client = fakeClient([toolUseResponse(validAppliedModel)]);
    const result = await applyAiFix(withParameters, finding, fix, { client });

    expect(result.model.workload.users).toEqual({ included: true, tier: 10_000, target: 1_000_000 });
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(applyAiFix(checkout, finding, fix)).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
