/**
 * `chatWithProject` against a fake Anthropic client - no network, no API
 * cost. A change request makes two sequential calls (route, then the
 * topology mutation, sharing the same `runStructuredCall` retry machinery
 * as every other inference module here); a question makes only the first.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { chatWithProject } from "../src/inference/chatWithProject.js";
import { checkout } from "../models/reference.js";
import { simulate } from "../src/solver.js";
import type { SystemModel } from "../src/types.js";

function toolUseResponse(name: string, input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name, input }],
  } as unknown as Anthropic.Message;
}

function fakeClient(
  responses: Anthropic.Message[],
  onCreate?: (params: Anthropic.MessageCreateParams) => void,
): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        onCreate?.(params);
        const response = responses[call];
        call++;
        if (!response) throw new Error("fakeClient: no more canned responses");
        return response;
      },
    },
  } as unknown as Anthropic;
}

const questionRoute = {
  isQuestion: true,
  reply: "The cache has a short TTL because showtime availability changes frequently.",
};

const changeRoute = { isQuestion: false, reply: "Adding a CDN in front of the API Gateway." };

const changedModel = {
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
      id: "cdn",
      label: "CDN",
      kind: "cache",
      ttl: { rationale: "Static assets cached at the edge.", provenance: "inferred", value: "long" },
      keyspaceSize: { rationale: "One entry per static asset.", provenance: "inferred", value: "large" },
      hasStampedeProtection: { rationale: "CDNs handle this natively.", provenance: "inferred", value: true },
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instanceCount: { rationale: "Eight instances.", provenance: "stated", value: "multiple" },
      hasCircuitBreaker: { rationale: "Protects downstream calls.", provenance: "stated", value: true },
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
    { from: "gw", to: "cdn" },
    { from: "gw", to: "svc" },
    { from: "svc", to: "db" },
  ],
};

describe("chatWithProject", () => {
  it("answers a question directly without touching the model", async () => {
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)]);
    const result = await chatWithProject(checkout, "why is the cache TTL short?", [], { client });

    expect(result.isQuestion).toBe(true);
    expect(result.reply).toMatch(/short TTL/i);
    expect(result.model).toBeUndefined();
  });

  it("implements a change request and returns the updated model", async () => {
    const client = fakeClient([
      toolUseResponse("route_chat_message", changeRoute),
      toolUseResponse("emit_system_model", changedModel),
    ]);
    const result = await chatWithProject(checkout, "add a CDN in front of the gateway", [], { client });

    expect(result.isQuestion).toBe(false);
    expect(result.reply).toMatch(/CDN/i);
    expect(result.model).toBeDefined();
    expect(() => simulate(result.model!)).not.toThrow();
    expect(result.model!.components.some((c) => c.id === "cdn")).toBe(true);
  });

  it("carries workload.users/requests forward unchanged on a change request", async () => {
    const withParameters: SystemModel = {
      ...checkout,
      workload: { ...checkout.workload, users: { included: true, tier: 10_000, target: 1_000_000 } },
    };
    const client = fakeClient([
      toolUseResponse("route_chat_message", changeRoute),
      toolUseResponse("emit_system_model", changedModel),
    ]);
    const result = await chatWithProject(withParameters, "add a CDN", [], { client });

    expect(result.model!.workload.users).toEqual({ included: true, tier: 10_000, target: 1_000_000 });
  });

  it("forwards prior conversation turns to both the route and change calls", async () => {
    const history: Anthropic.MessageParam[] = [
      { role: "user", content: "why is the cache TTL short?" },
      { role: "assistant", content: "Because showtime availability changes frequently." },
    ];
    const seenMessages: Anthropic.MessageParam[][] = [];
    const client = fakeClient(
      [toolUseResponse("route_chat_message", changeRoute), toolUseResponse("emit_system_model", changedModel)],
      (params) => seenMessages.push(params.messages),
    );

    await chatWithProject(checkout, "make it long-lived instead", history, { client });

    // Both calls (route, then change) should see the same prior history,
    // followed by the new user turn.
    expect(seenMessages).toHaveLength(2);
    for (const messages of seenMessages) {
      expect(messages[0]).toEqual(history[0]);
      expect(messages[1]).toEqual(history[1]);
      expect(messages[2]?.role).toBe("user");
    }
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(chatWithProject(checkout, "why?")).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
