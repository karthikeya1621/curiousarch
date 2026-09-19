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

// chatWithProject now always follows a change request with a second,
// sequential call to reviseExtendedComponents (see chatWithProject.ts's
// own top comment) — every fakeClient response list exercising a change
// request below needs one more canned response for it. Empty
// components/edges is a valid response and keeps every existing assertion
// about the route/change calls unaffected.
function emptyExtendedResponse(): Anthropic.Message {
  return toolUseResponse("emit_extended_components", { components: [], edges: [] });
}

const noFindings: never[] = [];
const noPendingFixes: never[] = [];

describe("chatWithProject", () => {
  it("answers a question directly without touching the model", async () => {
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)]);
    const result = await chatWithProject(
      checkout,
      "why is the cache TTL short?",
      [],
      noFindings,
      noPendingFixes,
      { client },
    );

    expect(result.isQuestion).toBe(true);
    expect(result.reply).toMatch(/short TTL/i);
    expect(result.model).toBeUndefined();
  });

  it("implements a change request and returns the updated model", async () => {
    const client = fakeClient([
      toolUseResponse("route_chat_message", changeRoute),
      toolUseResponse("emit_system_model", changedModel),
      emptyExtendedResponse(),
    ]);
    const result = await chatWithProject(
      checkout,
      "add a CDN in front of the gateway",
      [],
      noFindings,
      noPendingFixes,
      { client },
    );

    expect(result.isQuestion).toBe(false);
    expect(result.reply).toMatch(/CDN/i);
    expect(result.model).toBeDefined();
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
      emptyExtendedResponse(),
    ]);
    const result = await chatWithProject(withParameters, "add a CDN", [], noFindings, noPendingFixes, { client });

    expect(result.model!.workload.users).toEqual({ included: true, tier: 10_000, target: 1_000_000 });
  });

  it("preserves an existing extended component across a change request", async () => {
    const withExtended: SystemModel = {
      ...checkout,
      components: [
        ...checkout.components,
        {
          id: "payments",
          label: "Payment Processor API",
          kind: "external-dependency",
          hasTimeout: { rationale: "A timeout is configured.", provenance: "stated", value: true },
          hasFallback: { rationale: "No fallback configured.", provenance: "default", value: false },
        },
      ],
      edges: [...checkout.edges, { from: "svc", to: "payments" }],
    };
    const client = fakeClient([
      toolUseResponse("route_chat_message", changeRoute),
      toolUseResponse("emit_system_model", changedModel),
      // The revise call echoes the previous extended component back,
      // same as a real "keep by default" response would.
      toolUseResponse("emit_extended_components", {
        components: [withExtended.components[3]],
        edges: [{ from: "svc", to: "payments" }],
      }),
    ]);

    const result = await chatWithProject(withExtended, "add a CDN", [], noFindings, noPendingFixes, { client });

    expect(result.model!.components.some((c) => c.id === "payments")).toBe(true);
  });

  it("includes current findings and pending fixes as context in both prompts", async () => {
    const findings = [
      {
        code: "SINGLE_POINT_OF_FAILURE",
        severity: "critical" as const,
        componentId: "svc",
        title: "Single instance",
        explanation: "The order service runs as a single instance.",
        fixes: [],
      },
    ];
    const pendingFixes = [
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", fixTradeoff: "More cost." },
    ];
    const seenSystemPrompts: string[] = [];
    const client = fakeClient(
      [toolUseResponse("route_chat_message", questionRoute)],
      (params) => {
        const system = Array.isArray(params.system) ? params.system.map((s) => s.text).join("") : (params.system ?? "");
        seenSystemPrompts.push(system);
      },
    );

    await chatWithProject(checkout, "why is this risky?", [], findings, pendingFixes, { client });

    expect(seenSystemPrompts[0]).toMatch(/Single instance/);
    expect(seenSystemPrompts[0]).toMatch(/Add a second instance/);
  });

  it("forwards prior conversation turns to the route and change calls, but not the extended-components call", async () => {
    const history: Anthropic.MessageParam[] = [
      { role: "user", content: "why is the cache TTL short?" },
      { role: "assistant", content: "Because showtime availability changes frequently." },
    ];
    const seenMessages: Anthropic.MessageParam[][] = [];
    const client = fakeClient(
      [
        toolUseResponse("route_chat_message", changeRoute),
        toolUseResponse("emit_system_model", changedModel),
        emptyExtendedResponse(),
      ],
      (params) => seenMessages.push(params.messages),
    );

    await chatWithProject(checkout, "make it long-lived instead", history, noFindings, noPendingFixes, { client });

    // The route and change calls should see the same prior history,
    // followed by the new user turn. The extended-components revise call
    // (third) never receives conversation history — same as
    // reworkModel.ts's own equivalent call — so it's a single fresh turn.
    expect(seenMessages).toHaveLength(3);
    for (const messages of seenMessages.slice(0, 2)) {
      expect(messages[0]).toEqual(history[0]);
      expect(messages[1]).toEqual(history[1]);
      expect(messages[2]?.role).toBe("user");
    }
    expect(seenMessages[2]).toHaveLength(1);
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
