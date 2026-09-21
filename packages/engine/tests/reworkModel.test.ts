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
import type { SystemModel } from "../src/types.js";

// reworkModel's own schema no longer asks for workload at all (see
// reworkModel.ts's top comment — the user sets a tier by moving a
// control, not by describing one) — `workload: {}` is what the AI is
// actually asked to produce; `users`/`requests` are carried forward from
// the input model in code, tested separately below.
const validReworkInput = {
  id: "checkout",
  name: "Checkout / order placement",
  workload: {},
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

// reworkModel now always makes a second, sequential call to
// reviseExtendedComponents (see reworkModel.ts's own top comment) — every
// fakeClient response list below needs one more canned response for it.
// Empty components/edges is a valid response and keeps every existing
// assertion about the BASE rework call unaffected.
function emptyExtendedResponse(): Anthropic.Message {
  return {
    content: [
      { type: "tool_use", id: "call_extended", name: "emit_extended_components", input: { components: [], edges: [] } },
    ],
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

describe("reworkModel", () => {
  it("returns a model unrepaired when the first attempt validates", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [], { client });

    expect(result.repaired).toBe(false);
    // Confirms the rework kept the same id and preserved a component id
    // (svc) rather than the AI having renamed things.
    expect(result.model.id).toBe("checkout");
    expect(result.model.components.some((c) => c.id === "svc")).toBe(true);
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([
      toolUseResponse(invalidReworkInput),
      toolUseResponse(validReworkInput),
      emptyExtendedResponse(),
    ]);
    const result = await reworkModel(checkout, [], [], { client });

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

    await expect(reworkModel(checkout, [], [], { client, maxRetries: 1 })).rejects.toThrow(
      /still failed validation/i,
    );
  });

  it("defaults to 2 repair retries — more headroom than fromProse's 1, given a larger input", async () => {
    const client = fakeClient([
      toolUseResponse(invalidReworkInput),
      toolUseResponse(invalidReworkInput),
      toolUseResponse(validReworkInput),
      emptyExtendedResponse(),
    ]);

    const result = await reworkModel(checkout, [], [], { client });
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

  it("carries workload.users/requests forward unchanged — the AI's own schema never asks for them", async () => {
    const withParameters: SystemModel = {
      ...checkout,
      workload: {
        ...checkout.workload,
        users: { included: true, tier: 10_000, target: 1_000_000 },
        requests: { included: false, tier: 1000, target: 1000 },
      },
    };
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()]);
    const result = await reworkModel(withParameters, [], [], { client });

    expect(result.model.workload.users).toEqual({ included: true, tier: 10_000, target: 1_000_000 });
    expect(result.model.workload.requests).toEqual({ included: false, tier: 1000, target: 1000 });
  });

  it("includes queued pending fixes as explicit context in the user content, not the (cacheable) system prompt", async () => {
    let seenSystem: unknown;
    let seenUserContent: unknown;
    const client = fakeClient(
      [toolUseResponse(validReworkInput), emptyExtendedResponse()],
      (params) => {
        // Only the base rework call — the second, reviseExtendedComponents
        // call also fires onCreate, and would otherwise overwrite these
        // with its own (unrelated) system/user content.
        if ((params.tools?.[0] as { name?: string } | undefined)?.name !== "emit_system_model") return;
        seenSystem = params.system;
        seenUserContent = (params.messages[0] as { content: unknown }).content;
      },
    );

    await reworkModel(
      checkout,
      [
        {
          componentId: "svc",
          findingTitle: "No circuit breaker before the database",
          fixLabel: "Add a circuit breaker on the order service",
          fixTradeoff: "Failures surface as fast errors instead of hangs.",
        },
      ],
      [],
      { client },
    );

    expect(seenUserContent).toContain("svc");
    expect(seenUserContent).toContain("Add a circuit breaker on the order service");
    expect(seenUserContent).toContain("No circuit breaker before the database");
    // The static instructions must stay identical whether or not fixes
    // are queued, or the system-prompt cache never hits.
    expect(JSON.stringify(seenSystem)).not.toContain("circuit breaker");
  });

  it("omits the pending-fixes section entirely when none are queued", async () => {
    let seenUserContent: unknown;
    const client = fakeClient(
      [toolUseResponse(validReworkInput), emptyExtendedResponse()],
      (params) => {
        if ((params.tools?.[0] as { name?: string } | undefined)?.name !== "emit_system_model") return;
        seenUserContent = (params.messages[0] as { content: unknown }).content;
      },
    );

    await reworkModel(checkout, [], [], { client });

    expect(seenUserContent).not.toContain("specifically chosen to apply");
  });

  it("hands every queued chat change to BOTH calls — the user's words and the self-contained instruction, oldest first", async () => {
    const userContents: { tool: string; content: string }[] = [];
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      const tool = (params.tools?.[0] as { name?: string } | undefined)?.name ?? "";
      userContents.push({ tool, content: JSON.stringify((params.messages[0] as { content: unknown }).content) });
    });

    await reworkModel(
      checkout,
      [],
      [
        { request: "add a CDN", instruction: 'Add a CDN in front of "gw".' },
        { request: "put a cache behind it", instruction: 'Add a cache behind the CDN "cdn" from the previous change.' },
      ],
      { client },
    );

    // Base call AND the extended-components call: the latter is the one that
    // actually implements an extended-kind request such as a CDN, so it must
    // not be left seeing only the fixes.
    expect(userContents.map((c) => c.tool)).toEqual(["emit_system_model", "emit_extended_components"]);
    for (const { content } of userContents) {
      expect(content).toContain("add a CDN");
      expect(content).toContain("Add a CDN in front of");
      expect(content).toContain("put a cache behind it");
      expect(content.indexOf("add a CDN")).toBeLessThan(content.indexOf("put a cache behind it"));
    }
  });

  it("keeps queued chat changes out of the cacheable system prompt", async () => {
    let seenSystem: unknown;
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") seenSystem = params.system;
    });

    await reworkModel(checkout, [], [{ request: "add a CDN", instruction: "Add a CDN." }], { client });

    expect(JSON.stringify(seenSystem)).not.toContain("Add a CDN.");
  });
});
