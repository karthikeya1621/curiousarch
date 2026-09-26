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
import { REVISE_PROMPT } from "../src/inference/extendedComponents.js";
import { baseView, checkNoDroppedBaseComponents, checkNoDroppedEdges, dedupeEdges, dropEdgesToMentionedUnknowns, restoreDroppedConnections, describeScale, reconcileWithPrevious, reworkModel, stripExtendedReferences } from "../src/inference/reworkModel.js";
import { STRUCTURAL_SELF_CHECK } from "../src/inference/schema.js";
import { checkout } from "../models/reference.js";
import { cleanModelIdentity, unwrapIdentityText, type SystemModel } from "../src/types.js";

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

// Schema-invalid in a way no in-code normalisation can quietly repair: an edge
// to an id that isn't in the output. (An empty rationale on an UNCHANGED trait
// used to be the fixture, but reconcileWithPrevious now restores those from the
// input model before validation — by design.)
const invalidReworkInput = {
  ...validReworkInput,
  edges: [...validReworkInput.edges, { from: "svc", to: "ghost" }],
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
    expect(JSON.stringify(seenSystem)).not.toContain("Add a circuit breaker on the order service");
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
    expect(system).toMatch(/write it fresh every time, never copy an old one/);
    expect(system).toMatch(/not part of the described system/);
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
    expect(problem).toMatch(/dropped 1 connection/i);
  });

  it("lists and correctly pluralizes multiple dropped edges", () => {
    const broken: SystemModel = { ...checkout, edges: [] }; // both edges gone
    const problem = checkNoDroppedEdges(checkout, broken);
    expect(problem).toMatch(/dropped 2 connections/i);
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

    await expect(reworkModel(checkout, [], [], { client, maxRetries: 1 })).rejects.toThrow(/dropped 1 connection/i);
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
    // The revise step keeps the CDN it was given (an existing extended component may not vanish).
    const keepCdn = {
      content: [
        {
          type: "tool_use",
          id: "call_extended",
          name: "emit_extended_components",
          input: {
            components: [{ id: "cdn1", label: "Media CDN", kind: "cdn", hasOriginShield: { rationale: "No shielding described for the origin.", provenance: "default", value: false } }],
            edges: [{ from: "gw", to: "cdn1" }, { from: "cdn1", to: "svc" }],
          },
        },
      ],
    } as unknown as Anthropic.Message;
    const client = fakeClient([toolUseResponse(response), keepCdn], (params) => {
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
    expect(Object.keys(seen)).toEqual(["emit_system_model", "emit_extended_components"]); // one base call, one revise (a CDN alone gives the wiring review nothing to do)
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
    expect(system).toMatch(/back to the smallest when the scale is lowered/);
    expect(system).toMatch(/Do this on every rework, even when the user asked for nothing else/);
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

describe("checkNoDroppedEdges: what must survive is the connection", () => {
  const queue = { id: "q", kind: "queue", label: "Queue" } as never;

  it("accepts a direct edge replaced by a path through an inserted component", () => {
    const withQueue: SystemModel = {
      ...checkout,
      components: [...checkout.components, queue],
      edges: [{ from: "gw", to: "svc" }, { from: "svc", to: "q" }, { from: "q", to: "db" }],
    };
    expect(checkNoDroppedEdges(checkout, withQueue)).toBeNull();
  });

  it("does not count an edge the input listed twice as dropped twice — or at all once it's emitted once", () => {
    const duplicated: SystemModel = { ...checkout, edges: [...checkout.edges, { from: "svc", to: "db" }] };
    expect(checkNoDroppedEdges(duplicated, checkout)).toBeNull();
    const broken: SystemModel = { ...checkout, edges: [{ from: "gw", to: "svc" }] };
    expect(checkNoDroppedEdges(duplicated, broken)).toMatch(/dropped 1 connection/i);
  });

  it("dedupeEdges keeps each pair once, in order", () => {
    expect(dedupeEdges([{ from: "a", to: "b" }, { from: "a", to: "b" }, { from: "b", to: "a" }])).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ]);
  });

  it("the input the base call sees is deduplicated, and duplicate output edges are collapsed rather than retried", async () => {
    const dup: SystemModel = { ...checkout, edges: [...checkout.edges, { from: "svc", to: "db" }] };
    expect(baseView(dup).edges).toHaveLength(2);
    const client = fakeClient([
      toolUseResponse({ ...validReworkInput, edges: [...validReworkInput.edges, { from: "svc", to: "db" }] }),
      emptyExtendedResponse(),
    ]);
    const result = await reworkModel(dup, [], [], { client });
    expect(result.repaired).toBe(false);
    expect(result.model.edges.filter((e) => e.from === "svc" && e.to === "db")).toHaveLength(1);
  });
});

describe("reconcileWithPrevious", () => {
  const trait = (value: unknown, provenance: string, rationale: string) => ({ value, provenance, rationale });
  const prev = {
    components: [
      { id: "gw", kind: "gateway", label: "G", hasRateLimiting: trait(false, "default", "Not mentioned; typical first launch.") },
      { id: "svc", kind: "service", label: "S", instanceCount: trait("single", "default", "One instance at launch."), hasCircuitBreaker: trait(false, "default", "None yet.") },
    ],
    edges: [],
  } as unknown as SystemModel;
  const out = (components: unknown[]) => reconcileWithPrevious({ components, edges: [] }, prev, { anythingAsked: false, lowestTier: true }) as { components: Record<string, any>[] };

  it("keeps the previous PROVENANCE but takes the fresh rationale for a trait whose value didn't change (an old reason names an old scale)", () => {
    const gw = out([{ id: "gw", hasRateLimiting: trait(false, "stated", "Not part of the described system at this scale.") }]).components[0]!;
    expect(gw.hasRateLimiting).toEqual(trait(false, "default", "Not part of the described system at this scale."));
  });

  it("falls back to the old rationale only when the new one is empty", () => {
    const gw = out([{ id: "gw", hasRateLimiting: trait(false, "stated", "  ") }]).components[0]!;
    expect(gw.hasRateLimiting).toEqual(trait(false, "default", "Not mentioned; typical first launch."));
  });

  it("an unchanged instance count keeps its provenance but takes the fresh rationale, which names the current scale", () => {
    const [, svc] = out([{ id: "gw" }, { id: "svc", instanceCount: trait("single", "stated", "Launch tier, one instance is normal.") }]).components as Record<string, any>[];
    expect(svc!.instanceCount).toEqual(trait("single", "default", "Launch tier, one instance is normal."));
  });

  it("never lets a trait the rework changed be 'stated'", () => {
    const svc = out([{ id: "gw" }, { id: "svc", instanceCount: trait("multiple", "stated", "1M users.") }]).components[1]!;
    expect(svc.instanceCount).toEqual(trait("multiple", "inferred", "1M users."));
  });

  it("at the lowest tier nothing switches on by itself: an off protection stays off when nothing was asked for", () => {
    const svc = out([{ id: "gw" }, { id: "svc", hasCircuitBreaker: trait(true, "inferred", "Scale needs it.") }]).components[1]!;
    expect(svc.hasCircuitBreaker.value).toBe(false);
  });

  it("above the lowest tier a protection the AI switched on (by the tier group) is left alone", () => {
    const result = reconcileWithPrevious(
      { components: [{ id: "svc", hasCircuitBreaker: trait(true, "inferred", "The tier group calls for it.") }] },
      prev,
      { anythingAsked: false, lowestTier: false },
    ) as { components: Record<string, any>[] };
    expect(result.components[0]!.hasCircuitBreaker.value).toBe(true);
  });

  it("allows turning a protection on when a fix or chat change was queued, and a value it asked for stays 'stated'", () => {
    const result = reconcileWithPrevious(
      { components: [{ id: "svc", hasCircuitBreaker: trait(true, "stated", "The user asked for it.") }] },
      prev,
      { anythingAsked: true, lowestTier: true },
    ) as { components: Record<string, any>[] };
    expect(result.components[0]!.hasCircuitBreaker).toEqual(trait(true, "stated", "The user asked for it."));
  });

  it("does not touch a brand-new component's values, only caps 'stated'", () => {
    const c = out([{ id: "cache1", hasStampedeProtection: trait(true, "stated", "Popular keys.") }]).components[0]!;
    expect(c.hasStampedeProtection).toEqual(trait(true, "inferred", "Popular keys."));
  });

  it("passes anything that isn't a model through untouched", () => {
    const opts = { anythingAsked: false, lowestTier: true };
    expect(reconcileWithPrevious(null, prev, opts)).toBeNull();
    expect(reconcileWithPrevious({ components: "x" }, prev, opts)).toEqual({ components: "x" });
  });
});

describe("model id and name are never the AI's to change", () => {
  it("unwrapIdentityText peels a trait-style wrapper, a whole-model dump and nesting, and leaves ordinary text alone", () => {
    expect(unwrapIdentityText('{"value":"Google Search"}', "name")).toBe("Google Search");
    expect(unwrapIdentityText('{"value": "search-v1"}', "id")).toBe("search-v1");
    expect(unwrapIdentityText('{"id":"search-v1","name":"Search","components":[]}', "id")).toBe("search-v1");
    expect(unwrapIdentityText(JSON.stringify({ value: JSON.stringify({ value: "Deep" }) }), "name")).toBe("Deep");
    expect(unwrapIdentityText("Checkout {v2}", "name")).toBe("Checkout {v2}");
    expect(unwrapIdentityText('{"unrelated":1}', "name")).toBe('{"unrelated":1}');
    expect(unwrapIdentityText("{not json", "name")).toBe("{not json");
    expect(unwrapIdentityText('{"value":""}', "name")).toBe('{"value":""}');
  });

  it("cleanModelIdentity returns the same object when there is nothing to clean", () => {
    expect(cleanModelIdentity(checkout)).toBe(checkout);
    expect(cleanModelIdentity({ ...checkout, name: '{"value":"X"}' }).name).toBe("X");
  });

  it("keeps the input's (cleaned) id and name whatever the AI returns for them", async () => {
    const wrapped = { ...checkout, name: '{"value":"Checkout / order placement"}' };
    const client = fakeClient([
      toolUseResponse({ ...validReworkInput, id: '{"value": "checkout"}', name: '{"value":"Something else"}' }),
      emptyExtendedResponse(),
    ]);
    const result = await reworkModel(wrapped, [], [], { client });
    expect(result.model.id).toBe("checkout");
    expect(result.model.name).toBe("Checkout / order placement");
  });

  it("sends the AI the cleaned identity, so a wrapped name is not copied forward", async () => {
    let seen = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if (!seen) seen = JSON.stringify(params.messages);
    });
    await reworkModel({ ...checkout, name: '{"value":"Clean name"}' }, [], [], { client });
    expect(seen).toContain('\\"name\\":\\"Clean name\\"');
  });
});

describe("extended components are held to the same honesty rules as base ones", () => {
  const dep = (fallback: { value: boolean; provenance: string; rationale: string }) => ({
    id: "pay",
    label: "Payment provider",
    kind: "external-dependency",
    hasTimeout: { value: true, provenance: "default", rationale: "A timeout is the usual guard." },
    hasFallback: fallback,
  });
  const lowestTier = { users: { included: true, tier: 100, target: 100 } };
  const withDep: SystemModel = {
    ...checkout,
    workload: lowestTier,
    components: [...checkout.components, dep({ value: false, provenance: "default", rationale: "No fallback mentioned." }) as never],
    edges: [...checkout.edges, { from: "svc", to: "pay" }],
  };
  const reviseResponse = (fallback: { value: boolean; provenance: string; rationale: string }): Anthropic.Message =>
    ({
      content: [
        { type: "tool_use", id: "x", name: "emit_extended_components", input: { components: [dep(fallback)], edges: [{ from: "svc", to: "pay" }] } },
      ],
    }) as unknown as Anthropic.Message;
  const asked = [{ request: "give the payment provider a fallback", instruction: "Set hasFallback on pay to true." }];

  it("with nothing asked a changed trait comes back at most 'inferred', never 'stated'", async () => {
    const above: SystemModel = { ...withDep, workload: { users: { included: true, tier: 10_000, target: 10_000 } } };
    const client = fakeClient([toolUseResponse(validReworkInput), reviseResponse({ value: true, provenance: "stated", rationale: "The tier calls for it." })]);
    const result = await reworkModel(above, [], [], { client });
    const pay = result.model.components.find((c) => c.id === "pay") as unknown as { hasFallback: { provenance: string; value: boolean } };
    expect(pay.hasFallback).toMatchObject({ value: true, provenance: "inferred" });
  });

  it("with a request queued, the value it asked for keeps 'stated' (the user stated it)", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput), reviseResponse({ value: true, provenance: "stated", rationale: "Asked for." })]);
    const result = await reworkModel(withDep, [], asked, { client });
    const pay = result.model.components.find((c) => c.id === "pay") as unknown as { hasFallback: { provenance: string; value: boolean } };
    expect(pay.hasFallback).toMatchObject({ value: true, provenance: "stated" });
  });

  it("an unchanged trait keeps its earlier provenance and takes the fresh rationale", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput), reviseResponse({ value: false, provenance: "stated", rationale: "Rewritten." })]);
    const result = await reworkModel(withDep, [], [], { client });
    const pay = result.model.components.find((c) => c.id === "pay") as unknown as { hasFallback: { provenance: string; rationale: string } };
    expect(pay.hasFallback).toMatchObject({ provenance: "default", rationale: "Rewritten." });
  });

  it("a protection nobody asked for stays off", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput), reviseResponse({ value: true, provenance: "inferred", rationale: "Scale makes it worth having." })]);
    const result = await reworkModel(withDep, [], [], { client });
    const pay = result.model.components.find((c) => c.id === "pay") as unknown as { hasFallback: { value: boolean } };
    expect(pay.hasFallback.value).toBe(false);
  });
});

describe("dropEdgesToMentionedUnknowns", () => {
  const raw = {
    components: [{ id: "svc" }, { id: "db" }],
    edges: [{ from: "svc", to: "db" }, { from: "svc", to: "video-storage" }, { from: "svc", to: "ghost" }],
  };

  it("drops an edge to an id that is not in the output but is named in the queued request", () => {
    const out = dropEdgesToMentionedUnknowns(raw, 'Store videos: add object storage (id: "video-storage") and connect svc to it.') as typeof raw;
    expect(out.edges).toEqual([{ from: "svc", to: "db" }, { from: "svc", to: "ghost" }]);
  });

  it("leaves an unknown id nobody mentioned alone, so a real mistake still fails validation", () => {
    expect((dropEdgesToMentionedUnknowns(raw, "Add a cache.") as typeof raw).edges).toHaveLength(3);
    expect(dropEdgesToMentionedUnknowns(raw, "")).toBe(raw);
  });

  it("never drops an edge to a mentioned id that IS in the output, and never touches components", () => {
    const withNew = { ...raw, components: [...raw.components, { id: "video-storage" }] };
    const out = dropEdgesToMentionedUnknowns(withNew, "add video-storage") as typeof withNew;
    expect(out.edges).toHaveLength(3);
    expect(out.components).toBe(withNew.components);
  });
});

describe("requests the extended step owns don't cost a retry, and no connection is lost", () => {
  const asked = [{ request: "add a CDN in front of the gateway", instruction: "Add a CDN component in front of gw." }];
  const dropsGwSvc = { ...validReworkInput, edges: [{ from: "svc", to: "db" }] }; // rerouted "through" a CDN the base call can't emit

  it("accepts a base result that dropped an edge for such a request (one base response only — a retry would throw) and restores the edge", async () => {
    const client = fakeClient([toolUseResponse(dropsGwSvc), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], asked, { client });
    expect(result.repaired).toBe(false);
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "svc")).toBe(true);
  });

  it("with nothing queued the same drop is still rejected and retried", async () => {
    const client = fakeClient([toolUseResponse(dropsGwSvc), toolUseResponse(validReworkInput), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [], { client });
    expect(result.repaired).toBe(true);
  });

  it("with ANY request queued the base-only check stands down and the merged graph is repaired instead — no reading of the request's wording", async () => {
    const client = fakeClient([toolUseResponse(dropsGwSvc), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [{ request: "add rate limiting", instruction: "Turn on rate limiting." }], { client });
    expect(result.repaired).toBe(false);
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "svc")).toBe(true);
  });
});

describe("restoreDroppedConnections", () => {
  const e = (from: string, to: string) => ({ from, to });
  const comps = ["a", "b", "c", "q"].map((id) => ({ id }));

  it("puts back an original edge whose ends both survive but are no longer connected", () => {
    expect(restoreDroppedConnections([e("a", "b")], comps, [e("b", "c")])).toEqual([e("b", "c"), e("a", "b")]);
  });

  it("does not restore when a path now connects the ends (an inserted queue), or when an end is gone", () => {
    expect(restoreDroppedConnections([e("a", "b")], comps, [e("a", "q"), e("q", "b")])).toEqual([e("a", "q"), e("q", "b")]);
    expect(restoreDroppedConnections([e("a", "gone")], comps, [])).toEqual([]);
  });

  it("does not restore an edge that would close a cycle", () => {
    expect(restoreDroppedConnections([e("a", "b")], comps, [e("b", "c"), e("c", "a")])).toEqual([e("b", "c"), e("c", "a")]);
  });
});

describe("instance counts come from the tier groups, judged by the AI — not from a threshold in code", () => {
  it("gives the base rework call every tier group as guidance, and says it is judgement rather than a formula", async () => {
    let system = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") {
        system = (params.system as { text: string }[]).map((b) => b.text).join("");
      }
    });
    await reworkModel(checkout, [], [], { client });
    for (const group of ["Lowest tier (100 users", "Second tier (10,000 users", "Third tier (1,000,000 users", "Highest tier (100,000,000 users"]) {
      expect(system).toContain(group);
    }
    expect(system).toMatch(/not a formula/);
    expect(system).toMatch(/higher group/);
    expect(system).toMatch(/by its own role/);
  });

  it("does not change instance counts in code: a service the AI leaves single at 10K users stays single", async () => {
    const tenK: SystemModel = {
      ...checkout,
      workload: { users: { included: true, tier: 10_000, target: 1_000_000 } },
      components: checkout.components.map((c) =>
        c.id === "svc" ? ({ ...c, instanceCount: { value: "single", provenance: "default", rationale: "One instance at launch." } } as never) : c,
      ),
    };
    const singleSvc = {
      ...validReworkInput,
      components: validReworkInput.components.map((c) =>
        c.id === "svc" ? { ...c, instanceCount: { rationale: "One instance is enough here.", provenance: "inferred", value: "single" } } : c,
      ),
    };
    const client = fakeClient([toolUseResponse(singleSvc), emptyExtendedResponse()]);
    const result = await reworkModel(tenK, [], [], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { instanceCount: { value: string } };
    expect(svc.instanceCount.value).toBe("single");
  });
});

describe("load balancer routing on a Re-simulate", () => {
  const lb = {
    id: "lb1",
    label: "Load balancer",
    kind: "load-balancer",
    instanceCount: { value: "single", provenance: "default", rationale: "One balancer at launch scale." },
    hasHealthChecks: { value: false, provenance: "default", rationale: "No health checks described." },
  };
  const reviseWith = (edges: { from: string; to: string }[]): Anthropic.Message =>
    ({ content: [{ type: "tool_use", id: "x", name: "emit_extended_components", input: { components: [lb], edges } }] }) as unknown as Anthropic.Message;
  const withOldBalancer: SystemModel = {
    ...checkout,
    components: [...checkout.components, lb as never],
    edges: [...checkout.edges, { from: "lb1", to: "svc" }],
  };

  it("leaves a balancer that was already there exactly as the user has it: a direct call to the service stays", async () => {
    const client = fakeClient([toolUseResponse(validReworkInput), reviseWith([{ from: "lb1", to: "svc" }])]);
    const result = await reworkModel(withOldBalancer, [], [], { client });
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "svc")).toBe(true);
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "lb1")).toBe(false);
  });

  it("routes callers through a balancer this Re-simulate adds (the direct edge becomes gw -> lb -> svc)", async () => {
    const asked = [{ request: "add a load balancer in front of the order service", instruction: "Add a load balancer in front of svc." }];
    const client = fakeClient([toolUseResponse(validReworkInput), reviseWith([{ from: "lb1", to: "svc" }])]);
    const result = await reworkModel(checkout, [], asked, { client });
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "svc")).toBe(false);
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "lb1")).toBe(true);
  });

  it("a user's later edit sticks: once the balancer exists, removing a caller's route through it is not undone by the next Re-simulate", async () => {
    // gw calls svc directly while an existing balancer also fronts it — the user's own arrangement
    const client = fakeClient([toolUseResponse(validReworkInput), reviseWith([{ from: "lb1", to: "svc" }])]);
    const result = await reworkModel(withOldBalancer, [], [{ request: "let the gateway call the service directly", instruction: "Keep gw -> svc." }], { client });
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "svc")).toBe(true);
    expect(result.model.edges.some((e) => e.from === "gw" && e.to === "lb1")).toBe(false);
  });
});

describe("tier-driven values follow the tier in both directions", () => {
  const lowered = (tier: number): SystemModel => ({ ...checkout, workload: { users: { included: true, tier, target: 1_000_000 } } });
  const svcWithBreaker = (provenance: string) => ({
    ...validReworkInput,
    components: validReworkInput.components.map((c) =>
      c.id === "svc" ? { ...c, hasCircuitBreaker: { rationale: "Set by an earlier scale-up.", provenance, value: true } } : c,
    ),
  });
  const modelWithOn = (tier: number, provenance: string): SystemModel => ({
    ...lowered(tier),
    components: checkout.components.map((c) =>
      c.id === "svc" ? ({ ...c, hasCircuitBreaker: { rationale: "Set by an earlier scale-up.", provenance, value: true } } as never) : c,
    ),
  });

  it("lowering the scale to the bottom rung with nothing queued returns an inferred protection to off", async () => {
    const client = fakeClient([toolUseResponse(svcWithBreaker("inferred")), emptyExtendedResponse()]);
    const result = await reworkModel(modelWithOn(100, "inferred"), [], [], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { hasCircuitBreaker: { value: boolean; rationale: string } };
    expect(svc.hasCircuitBreaker.value).toBe(false);
  });

  it("…but one the description states stays on at any scale", async () => {
    const client = fakeClient([toolUseResponse(svcWithBreaker("stated")), emptyExtendedResponse()]);
    const result = await reworkModel(modelWithOn(100, "stated"), [], [], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { hasCircuitBreaker: { value: boolean } };
    expect(svc.hasCircuitBreaker.value).toBe(true);
  });

  it("above the bottom rung the AI's tier-based protections stand", async () => {
    const client = fakeClient([toolUseResponse(svcWithBreaker("inferred")), emptyExtendedResponse()]);
    const result = await reworkModel(modelWithOn(1_000_000, "inferred"), [], [], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { hasCircuitBreaker: { value: boolean } };
    expect(svc.hasCircuitBreaker.value).toBe(true);
  });

  it("with a request queued, an inferred protection at the lowest tier still goes off (an unrelated request must not let it through)", async () => {
    const client = fakeClient([toolUseResponse(svcWithBreaker("inferred")), emptyExtendedResponse()]);
    const result = await reworkModel(modelWithOn(100, "inferred"), [], [{ request: "add a cache", instruction: "Add a cache." }], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { hasCircuitBreaker: { value: boolean } };
    expect(svc.hasCircuitBreaker.value).toBe(false);
  });

  it("…while a value the queued request asked for (labelled stated) stays on", async () => {
    const client = fakeClient([toolUseResponse(svcWithBreaker("stated")), emptyExtendedResponse()]);
    const result = await reworkModel(modelWithOn(100, "stated"), [], [{ request: "add a breaker", instruction: "Turn on the breaker on svc." }], { client });
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { hasCircuitBreaker: { value: boolean } };
    expect(svc.hasCircuitBreaker.value).toBe(true);
  });

  it("at the lowest tier a protection switched on unasked during an unrelated request is reverted by the reconcile step", () => {
    const prev = { components: [{ id: "gw", kind: "gateway", label: "G", hasRateLimiting: { value: false, provenance: "default", rationale: "Not part of the system." } }], edges: [] } as unknown as SystemModel;
    const on = (provenance: string) =>
      reconcileWithPrevious({ components: [{ id: "gw", hasRateLimiting: { value: true, provenance, rationale: "Because." } }] }, prev, { anythingAsked: true, lowestTier: true }) as { components: Record<string, any>[] };
    expect(on("inferred").components[0]!.hasRateLimiting.value).toBe(false);
    expect(on("stated").components[0]!.hasRateLimiting.value).toBe(true);
  });

  it("both prompts carry the same protection guidance, and the base one no longer says scale never switches a protection on", async () => {
    let system = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") system = (params.system as { text: string }[]).map((b) => b.text).join("");
    });
    await reworkModel(checkout, [], [], { client });
    expect(system).toMatch(/Protections follow the tier too, but only the BASELINE/);
    expect(system).toMatch(/Tier-driven values are yours to keep right/);
    expect(system).toMatch(/OR a listed fix or requested change asked for exactly this value \(the user stated it\)/);
    expect(system).not.toMatch(/Scale alone never switches on a protection/);
  });
});

describe("no component is silently dropped, and none is invented", () => {
  it("checkNoDroppedBaseComponents names exactly the missing base ids and ignores extended ones", () => {
    const withExt = { ...checkout, components: [...checkout.components, { id: "cdn1", kind: "cdn", label: "CDN" } as never] };
    const minusDb = { ...checkout, components: checkout.components.filter((c) => c.id !== "db") };
    expect(checkNoDroppedBaseComponents(withExt, minusDb)).toMatch(/dropped 1 existing component without being asked to: "db"/);
    expect(checkNoDroppedBaseComponents(withExt, checkout)).toBeNull(); // cdn1 is not this call's to keep
  });

  it("a rework that drops a base component with nothing queued is rejected and retried", async () => {
    const minusDb = { ...validReworkInput, components: validReworkInput.components.filter((c) => c.id !== "db"), edges: [{ from: "gw", to: "svc" }] };
    const client = fakeClient([toolUseResponse(minusDb), toolUseResponse(validReworkInput), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [], { client });
    expect(result.repaired).toBe(true);
    expect(result.model.components.some((c) => c.id === "db")).toBe(true);
  });

  it("with a request queued the same removal is accepted (it may be the request)", async () => {
    const minusDb = { ...validReworkInput, components: validReworkInput.components.filter((c) => c.id !== "db"), edges: [{ from: "gw", to: "svc" }] };
    const client = fakeClient([toolUseResponse(minusDb), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [{ request: "remove the database", instruction: "Remove db." }], { client });
    expect(result.model.components.some((c) => c.id === "db")).toBe(false);
  });

  it("both reworks are told to add a component only when asked or needed, never because such systems typically have one", async () => {
    let base = "";
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      if ((params.tools?.[0] as { name?: string } | undefined)?.name === "emit_system_model") base = (params.system as { text: string }[]).map((b) => b.text).join("");
    });
    await reworkModel(checkout, [], [], { client });
    expect(base).toMatch(/Add a NEW component only when a listed fix or requested change asks for it/);
    expect(REVISE_PROMPT).toMatch(/Add a NEW extended component only when the description, a listed fix or a requested change calls for it/);
  });
});

describe("a stated value is a fact: nothing changes it unless a request asks", () => {
  const stated = { components: [{ id: "gw", kind: "gateway", label: "G", hasRateLimiting: { value: true, provenance: "stated", rationale: "The description says per-user limits." } }], edges: [] } as unknown as SystemModel;
  const off = (opts: { anythingAsked: boolean; lowestTier: boolean }) =>
    reconcileWithPrevious({ components: [{ id: "gw", hasRateLimiting: { value: false, provenance: "inferred", rationale: "Second tier has no protections." } }] }, stated, opts) as { components: Record<string, any>[] };

  it("an AI that switches a stated protection off at any tier is put back (live: a stated rate limit went off at 10K users)", () => {
    for (const lowestTier of [true, false]) {
      expect(off({ anythingAsked: false, lowestTier }).components[0]!.hasRateLimiting).toEqual({ value: true, provenance: "stated", rationale: "The description says per-user limits." });
    }
  });

  it("…but with a request queued the change stands (the request may be to remove it)", () => {
    expect(off({ anythingAsked: true, lowestTier: false }).components[0]!.hasRateLimiting.value).toBe(false);
  });
});

describe("a change that is only about extended kinds is not shown to the base call", () => {
  const seen = (input: { changes?: { request: string; instruction: string; kinds?: string[] }[]; fixes?: never[] }) => {
    const content: Record<string, string> = {};
    const client = fakeClient([toolUseResponse(validReworkInput), emptyExtendedResponse()], (params) => {
      const tool = (params.tools?.[0] as { name?: string } | undefined)?.name ?? "";
      content[tool] = JSON.stringify((params.messages[0] as { content: unknown }).content);
    });
    return { content, run: () => reworkModel(checkout, input.fixes ?? [], input.changes ?? [], { client }) };
  };
  const lbChange = { request: "add a second load balancer", instruction: "Add a load-balancer in front of svc.", kinds: ["load-balancer"] };

  it("an extended-only change reaches the revise step and NOT the base call (which once improvised a base-kind stand-in)", async () => {
    const { content, run } = seen({ changes: [lbChange] });
    await run();
    expect(content["emit_system_model"]).not.toContain("Add a load-balancer in front of svc.");
    expect(content["emit_extended_components"]).toContain("Add a load-balancer in front of svc.");
  });

  it("a change that touches a base kind too goes to both, and one with no classification (queued earlier) goes to both", async () => {
    for (const change of [{ ...lbChange, kinds: ["load-balancer", "service"] }, { request: lbChange.request, instruction: lbChange.instruction }]) {
      const { content, run } = seen({ changes: [change] });
      await run();
      expect(content["emit_system_model"]).toContain("Add a load-balancer in front of svc.");
      expect(content["emit_extended_components"]).toContain("Add a load-balancer in front of svc.");
    }
  });

  it("a queued change still counts as 'something was asked' when it is extended-only (the checks that depend on it stand down)", async () => {
    const dropsGwSvc = { ...validReworkInput, edges: [{ from: "svc", to: "db" }] };
    const client = fakeClient([toolUseResponse(dropsGwSvc), emptyExtendedResponse()]);
    const result = await reworkModel(checkout, [], [lbChange], { client });
    expect(result.repaired).toBe(false); // no retry for the dropped edge: the request may reroute it
  });
});
