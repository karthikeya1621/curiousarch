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
import { baseView, checkNoDroppedEdges, describeScale, reworkModel, stripExtendedReferences } from "../src/inference/reworkModel.js";
import { STRUCTURAL_SELF_CHECK } from "../src/inference/schema.js";
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

  // Output tokens are ~60% of a clean Re-simulate's cost (measured from real
  // usage data), and most of a rework's output is per-trait rationale prose.
  it("asks for short rationales — and keeps the ask at 8+ words, so brevity can't trip the validator's 10-character minimum", async () => {
    let system = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") {
        system = (params.system as { text: string }[]).map((b) => b.text).join("");
      }
    });
    await reworkModel(checkout, [], [], { client });
    expect(system).toMatch(/one short, specific sentence of roughly 8 to 15 words/);
    expect(system).toMatch(/restate its reason more briefly/);
  });

  it("carries the superRefine-only self-check into the prompt — the failure classes a repair-retry costs a full extra billed call for", async () => {
    let seenSystem: unknown;
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") seenSystem = params.system;
    });

    await reworkModel(checkout, [], [], { client });

    const system = Array.isArray(seenSystem) ? seenSystem.map((s) => s.text).join("") : (seenSystem as string);
    expect(system).toContain(STRUCTURAL_SELF_CHECK);
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

describe("checkNoDroppedEdges", () => {
  // checkout: gw --> svc --> db. Minimal objects below deliberately omit
  // trait fields the function never reads (only .id/.kind matter to it).
  const cdn = { id: "cdn1", kind: "cdn", label: "CDN" } as unknown as SystemModel["components"][number];

  it("is fine when nothing changed", () => {
    expect(checkNoDroppedEdges(checkout, checkout)).toBeNull();
  });

  it("is fine when the result only ADDS components/edges on top of the original", () => {
    const grown: SystemModel = {
      ...checkout,
      components: [...checkout.components, { id: "cache1", kind: "cache", label: "Cache" } as never],
      edges: [...checkout.edges, { from: "svc", to: "cache1" }],
    };
    expect(checkNoDroppedEdges(checkout, grown)).toBeNull();
  });

  it("flags an edge dropped between two components the result still keeps", () => {
    const broken: SystemModel = { ...checkout, edges: [{ from: "gw", to: "svc" }] }; // svc -> db missing
    const problem = checkNoDroppedEdges(checkout, broken);
    expect(problem).toMatch(/"svc" -> "db"/);
    expect(problem).toMatch(/dropped 1 edge/i);
  });

  it("lists and correctly pluralizes multiple dropped edges", () => {
    const broken: SystemModel = { ...checkout, edges: [] }; // both edges gone
    const problem = checkNoDroppedEdges(checkout, broken);
    expect(problem).toMatch(/dropped 2 edges/i);
    expect(problem).toMatch(/"gw" -> "svc"/);
    expect(problem).toMatch(/"svc" -> "db"/);
    expect(problem).toMatch(/restore them/i);
  });

  it("does NOT flag an edge whose component the result legitimately removed — nothing to preserve once it's gone", () => {
    const withoutDb: SystemModel = {
      ...checkout,
      components: checkout.components.filter((c) => c.id !== "db"),
      edges: [{ from: "gw", to: "svc" }], // svc -> db correctly absent, since db itself is gone
    };
    expect(checkNoDroppedEdges(checkout, withoutDb)).toBeNull();
  });

  it("does NOT flag an edge to an extended-kind component — never this call's to keep in the first place", () => {
    const withExtended: SystemModel = {
      ...checkout,
      components: [...checkout.components, cdn],
      edges: [...checkout.edges, { from: "svc", to: "cdn1" }],
    };
    // The base call's own output correctly omits both the extended component
    // AND the edge to it — by design (see REWORK_PROMPT), not a drop.
    const baseOutput: SystemModel = checkout;
    expect(checkNoDroppedEdges(withExtended, baseOutput)).toBeNull();
  });
});

describe("reworkModel: rejecting a schema-valid but substantively empty repair", () => {
  // Reproduces, structurally, what was found live on a real Re-simulate: the
  // first attempt is a badly degenerate model (schema-invalid on its own,
  // for an unrelated reason), and instead of regenerating a real answer, the
  // "repaired" second attempt patches just enough to pass Zod while still
  // dropping an edge between two components it kept. validateResult must
  // catch that and force a THIRD attempt, rather than accepting attempt 2.
  const degenerate = { ...invalidReworkInput }; // fails schema validation on its own (existing fixture)
  const patchedButStillBroken = { ...validReworkInput, edges: [{ from: "gw", to: "svc" }] }; // drops svc -> db
  const trulyFixed = validReworkInput; // preserves every original edge

  it("forces a further retry when a schema-valid result still drops a kept edge, and accepts the next attempt that doesn't", async () => {
    const client = fakeClient([
      toolUseResponse(degenerate),
      toolUseResponse(patchedButStillBroken),
      toolUseResponse(trulyFixed),
      emptyExtendedResponse(),
    ]);

    const result = await reworkModel(checkout, [], [], { client });

    expect(result.repaired).toBe(true);
    expect(result.model.edges.some((e) => e.from === "svc" && e.to === "db")).toBe(true);
  });

  it("still throws once maxRetries is exhausted by continuity failures alone, schema failures aside", async () => {
    const client = fakeClient([
      toolUseResponse(patchedButStillBroken),
      toolUseResponse(patchedButStillBroken),
    ]);

    await expect(reworkModel(checkout, [], [], { client, maxRetries: 1 })).rejects.toThrow(/dropped 1 edge/i);
  });
});

describe("the base call never sees the extended components", () => {
  // checkout + a CDN wired both ways (gw -> cdn1, cdn1 -> svc). Minimal
  // objects: only id/kind/label matter to what's under test.
  const cdn = { id: "cdn1", kind: "cdn", label: "Media CDN" } as unknown as SystemModel["components"][number];
  const withCdn: SystemModel = {
    ...checkout,
    components: [...checkout.components, cdn],
    edges: [...checkout.edges, { from: "gw", to: "cdn1" }, { from: "cdn1", to: "svc" }],
  };

  function baseCallContent(model: SystemModel, response: unknown = validReworkInput) {
    const seen: Record<string, string> = {};
    const client = fakeClient([toolUseResponse(response), emptyExtendedResponse()], (params) => {
      const tool = (params.tools?.[0] as { name?: string } | undefined)?.name ?? "";
      seen[tool] = JSON.stringify((params.messages[0] as { content: unknown }).content);
    });
    return { client, seen, run: () => reworkModel(model, [], [], { client }) };
  }

  it("baseView drops every extended component and every edge touching one, without mutating the model", () => {
    const view = baseView(withCdn);
    expect(view.components.map((c) => c.id)).toEqual(["gw", "svc", "db"]);
    expect(view.edges).toEqual(checkout.edges);
    expect(withCdn.components).toHaveLength(4); // untouched
    expect(withCdn.edges).toHaveLength(4);
  });

  it("baseView of a model with no extended components is equal to it", () => {
    expect(baseView(checkout)).toEqual(checkout);
  });

  it("sends the base call no extended id and no edge to one — only a note that they exist, by name, never id", async () => {
    const { seen, run } = baseCallContent(withCdn);
    await run();

    const content = seen["emit_system_model"]!;
    expect(content).not.toContain("cdn1");
    expect(content).toContain('cdn \\"Media CDN\\"'); // kind and label, so it can reason about them
    expect(content).toContain("separate step");
    expect(content).toContain('\\"from\\":\\"svc\\",\\"to\\":\\"db\\"'); // base edges are still there
  });

  it("says nothing about extended parts when there are none", async () => {
    const { seen, run } = baseCallContent(checkout);
    await run();
    expect(seen["emit_system_model"]).not.toContain("separate step you cannot see");
  });

  it("stripExtendedReferences drops a stand-in component using an extended id, and every edge touching one", () => {
    const raw = {
      id: "x",
      components: [{ id: "gw" }, { id: "cdn1" }, { id: "svc" }],
      edges: [
        { from: "gw", to: "svc" },
        { from: "svc", to: "cdn1" },
        { from: "cdn1", to: "gw" },
      ],
    };
    expect(stripExtendedReferences(raw, new Set(["cdn1"]))).toEqual({
      id: "x",
      components: [{ id: "gw" }, { id: "svc" }],
      edges: [{ from: "gw", to: "svc" }],
    });
  });

  it("stripExtendedReferences leaves an unknown id that ISN'T an extended one alone — that's a real error, not this fix's business", () => {
    const raw = { components: [{ id: "gw" }], edges: [{ from: "gw", to: "ghost" }] };
    expect(stripExtendedReferences(raw, new Set(["cdn1"]))).toEqual(raw);
  });

  it("stripExtendedReferences passes anything odd straight through", () => {
    expect(stripExtendedReferences(null, new Set(["a"]))).toBeNull();
    expect(stripExtendedReferences("nope", new Set(["a"]))).toBe("nope");
    const raw = { components: [{ id: "cdn1" }] };
    expect(stripExtendedReferences(raw, new Set())).toBe(raw); // nothing extended: untouched, same object
  });

  it("a base response that still names an extended id (from the user's own queued text) costs no retry — it's stripped, not rejected", async () => {
    const leaky = { ...validReworkInput, edges: [...validReworkInput.edges, { from: "svc", to: "cdn1" }] };
    const { run, seen } = baseCallContent(withCdn, leaky);

    const result = await run();

    expect(result.repaired).toBe(false);
    expect(Object.keys(seen)).toEqual(["emit_system_model", "emit_extended_components"]); // one base call, one revise
    expect(result.model.edges.some((e) => e.to === "cdn1" && e.from === "svc")).toBe(false);
  });

  it("hands the revise step the ORIGINAL edges that touch an extended component, in their original direction", async () => {
    const { run, seen } = baseCallContent(withCdn);
    await run();

    const content = seen["emit_extended_components"]!;
    expect(content).toContain("Existing edges touching them");
    expect(content).toContain('\\"from\\":\\"gw\\",\\"to\\":\\"cdn1\\"');
    expect(content).toContain('\\"from\\":\\"cdn1\\",\\"to\\":\\"svc\\"');
    expect(content).not.toContain('\\"from\\":\\"svc\\",\\"to\\":\\"db\\"'); // base-to-base edges aren't its business
  });
});

describe("instance counts are set automatically", () => {
  it("tells the base rework call to raise instanceCount itself when the scale needs it, and to leave it small otherwise", async () => {
    let system = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") {
        system = (params.system as { text: string }[]).map((b) => b.text).join("");
      }
    });
    await reworkModel(checkout, [], [], { client });

    expect(system).toMatch(/Instance counts are yours to keep right, automatically/);
    expect(system).toMatch(/leave it at the smallest value/);
    expect(system).toMatch(/nobody will separately ask you to/);
  });

  it.each([
    [{ users: { included: true, tier: 10_000, target: 1_000_000 } }, "\n\nThe system's current scale is 10,000 users."],
    [
      { users: { included: true, tier: 100, target: 1_000_000 }, requests: { included: true, tier: 100_000, target: 100_000 } },
      "\n\nThe system's current scale is 100 users and 100,000 requests.",
    ],
    [{ users: { included: false, tier: 100, target: 100 } }, ""],
    [{}, ""],
  ])("describeScale %#", (workload, expected) => {
    expect(describeScale(workload as never)).toBe(expected);
  });

  it("tells the extended-components step the current scale, so it can size a load balancer — it was never shown the workload before", async () => {
    let reviseContent = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_extended_components") {
        reviseContent = JSON.stringify((params.messages[0] as { content: unknown }).content);
      }
    });
    const scaled: SystemModel = { ...checkout, workload: { users: { included: true, tier: 10_000, target: 1_000_000 } } };
    await reworkModel(scaled, [], [], { client });

    expect(reviseContent).toContain("current scale is 10,000 users");
  });
});
