/**
 * `proposeExtendedComponents`/`reviseExtendedComponents` against a fake
 * Anthropic client — no network, no API cost. Mirrors
 * `workloadParameters.test.ts`'s fake-client pattern: both share
 * `runStructuredCall`'s validate -> repair-retry -> give-up state machine.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  proposeExtendedComponents,
  reviseExtendedComponents,
  isExtendedComponent,
  EXTENDED_KINDS,
  PROPOSE_PROMPT,
  REVISE_PROMPT,
  checkNoDroppedExtendedEdges,
  checkNoDroppedExtendedComponents,
  mergeRevision,
  checkDecisionsMatchComponents,
  checkReviseDecisionsMatchComponents,
  buildExtendedToolInputSchema,
  ReviseResponseSchema,
} from "../src/inference/extendedComponents.js";
import { MAX_EXTENDED_COMPONENTS, MAX_TOTAL_COMPONENTS } from "../src/types.js";

const baseModel = {
  components: [
    { id: "gw", label: "API Gateway", kind: "gateway" as const },
    { id: "checkout-svc", label: "Checkout Service", kind: "service" as const },
  ],
};

const stripeComponent = {
  id: "stripe-api",
  label: "Stripe Payment API",
  kind: "external-dependency",
  hasTimeout: { rationale: "No timeout configured per the description.", provenance: "stated", value: false },
  hasFallback: { rationale: "Nothing mentioned.", provenance: "default", value: false },
};

const validResponse = {
  components: [stripeComponent],
  edges: [{ from: "checkout-svc", to: "stripe-api" }],
};

const invalidResponse = {
  components: [{ ...stripeComponent, hasTimeout: { ...stripeComponent.hasTimeout, rationale: "" } }],
  edges: [{ from: "checkout-svc", to: "stripe-api" }],
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_extended_components", input }],
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

describe("proposeExtendedComponents", () => {
  it("returns parsed components and edges when the response validates", async () => {
    const client = fakeClient([toolUseResponse(validResponse)]);
    const result = await proposeExtendedComponents("A checkout service calling Stripe with no timeout.", baseModel, { client });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.kind).toBe("external-dependency");
    expect(result.edges).toEqual([{ from: "checkout-svc", to: "stripe-api" }]);
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([toolUseResponse(invalidResponse), toolUseResponse(validResponse)]);
    const result = await proposeExtendedComponents("desc", baseModel, { client });

    expect(result.components).toHaveLength(1);
  });

  it("drops an edge referencing an id that doesn't exist in either the base model or the new components", async () => {
    const client = fakeClient([
      toolUseResponse({
        components: [stripeComponent],
        edges: [
          { from: "checkout-svc", to: "stripe-api" },
          { from: "checkout-svc", to: "some-made-up-id" },
        ],
      }),
    ]);
    const result = await proposeExtendedComponents("desc", baseModel, { client });

    expect(result.edges).toEqual([{ from: "checkout-svc", to: "stripe-api" }]);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(proposeExtendedComponents("desc", baseModel)).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  // Found live: two components in one response sharing an id (both
  // literally "scheduled-job") reached the diagram and crashed React
  // Flow with a duplicate-key error. The schema now rejects this at parse
  // time (triggering the usual repair retry) instead of letting it through.
  it("repairs once when the response has two components sharing the same id", async () => {
    const duplicateIdResponse = {
      components: [
        { ...stripeComponent, id: "scheduled-job" },
        {
          id: "scheduled-job",
          label: "Nightly Reconciliation",
          kind: "scheduled-job",
          hasLocking: { rationale: "r", provenance: "default", value: false },
          isIdempotent: { rationale: "r", provenance: "default", value: false },
        },
      ],
      edges: [],
    };
    const client = fakeClient([toolUseResponse(duplicateIdResponse), toolUseResponse(validResponse)]);
    const result = await proposeExtendedComponents("desc", baseModel, { client });

    expect(result.components).toHaveLength(1);
  });

  it("drops a proposed component whose id collides with an existing base component's id", async () => {
    const client = fakeClient([
      toolUseResponse({
        components: [{ ...stripeComponent, id: "checkout-svc" }],
        edges: [],
      }),
    ]);
    const result = await proposeExtendedComponents("desc", baseModel, { client });

    expect(result.components).toEqual([]);
  });

  it("repairs once when a single response has more than MAX_EXTENDED_COMPONENTS components", async () => {
    const tooMany = {
      components: Array.from({ length: MAX_EXTENDED_COMPONENTS + 1 }, (_, i) => ({
        ...stripeComponent,
        id: `ext-${i}`,
      })),
      edges: [],
    };
    const client = fakeClient([toolUseResponse(tooMany), toolUseResponse(validResponse)]);
    const result = await proposeExtendedComponents("desc", baseModel, { client });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.id).toBe("stripe-api");
  });

  it("truncates to the remaining MAX_TOTAL_COMPONENTS budget even when a response is under the per-call cap", async () => {
    // Base model already has just enough components that only a few more
    // extended ones fit under MAX_TOTAL_COMPONENTS — fewer than
    // MAX_EXTENDED_COMPONENTS itself, so this wouldn't be caught by the
    // schema's own per-response cap alone.
    const remaining = 2;
    const bigBaseModel = {
      components: Array.from({ length: MAX_TOTAL_COMPONENTS - remaining }, (_, i) => ({
        id: `svc-${i}`,
        label: `Service ${i}`,
        kind: "service" as const,
      })),
    };
    const tooManyForBudget = {
      components: Array.from({ length: remaining + 2 }, (_, i) => ({ ...stripeComponent, id: `ext-${i}` })),
      edges: [],
    };
    const client = fakeClient([toolUseResponse(tooManyForBudget)]);
    const result = await proposeExtendedComponents("desc", bigBaseModel, { client });

    expect(result.components).toHaveLength(remaining);
  });
});

describe("reviseExtendedComponents", () => {
  it("returns the revised components and edges when the response validates", async () => {
    const client = fakeClient([toolUseResponse(validResponse)]);
    const result = await reviseExtendedComponents([], baseModel, { client });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.id).toBe("stripe-api");
  });

  it("filters edges against the freshly reworked base model's ids, not the previous ones", async () => {
    const client = fakeClient([
      toolUseResponse({
        components: [stripeComponent],
        // "old-svc" no longer exists in the reworked base model below.
        edges: [{ from: "old-svc", to: "stripe-api" }],
      }),
    ]);
    const reworkedBaseModel = { components: [{ id: "gw", label: "API Gateway", kind: "gateway" as const }] };
    const result = await reviseExtendedComponents([], reworkedBaseModel, { client });

    expect(result.edges).toEqual([]);
  });
});

describe("isExtendedComponent / EXTENDED_KINDS", () => {
  it("is true for each of the 7 extended kinds and false for a base kind", () => {
    for (const kind of EXTENDED_KINDS) {
      expect(isExtendedComponent({ kind } as never)).toBe(true);
    }
    expect(isExtendedComponent({ kind: "gateway" } as never)).toBe(false);
  });
});

describe("PROPOSE_PROMPT / REVISE_PROMPT", () => {
  it("both ask for short rationales, via the shared kind guide", () => {
    for (const prompt of [PROPOSE_PROMPT, REVISE_PROMPT]) expect(prompt).toMatch(/roughly 8 to 15 words/);
  });

  // Regression test for a confirmed-live bug: REVISE_PROMPT used to say
  // 'never a placeholder like "n/a" or "invalid"', and a real Re-simulate
  // produced literally the word "placeholder" as a component's rationale —
  // reproducing it again, unchanged, on the very next repair attempt for
  // the same field. Naming the exact banned word as the negative example
  // primes the model toward it; see schema.ts's STRUCTURAL_SELF_CHECK doc
  // comment for the full account. Only checking the distinctive words —
  // "none"/"invalid" are also banned but too common as ordinary English to
  // substring-check safely across a whole prompt.
  it("never spells out a banned rationale word as an example, in either prompt", () => {
    for (const prompt of [PROPOSE_PROMPT, REVISE_PROMPT]) {
      const text = prompt.toLowerCase();
      for (const word of ["placeholder", "lorem ipsum", "tbd", "n/a"]) {
        expect(text).not.toContain(word);
      }
    }
  });
});

describe("checkNoDroppedExtendedEdges", () => {
  // The real YouTube Re-simulate that motivated this: the revise step was
  // never shown the existing wiring, dropped two edges and reversed one.
  const previous = [
    { from: "video-service", to: "object-storage" },
    { from: "object-storage", to: "cdn" },
    { from: "cdn", to: "video-service" },
    { from: "video-service", to: "transcode-job" },
  ];
  const baseIds = new Set(["gateway", "video-service"]);
  const ext = (...ids: string[]) => ids.map((id) => ({ id }));
  const all = ext("object-storage", "cdn", "transcode-job");

  it("is fine when every existing edge is kept exactly", () => {
    expect(checkNoDroppedExtendedEdges(previous, baseIds, { components: all, edges: [...previous] })).toBeNull();
  });

  it("is fine with extra edges added on top", () => {
    expect(
      checkNoDroppedExtendedEdges(previous, baseIds, {
        components: all,
        edges: [...previous, { from: "transcode-job", to: "primary-db" }],
      }),
    ).toBeNull();
  });

  it("flags a dropped edge", () => {
    const edges = previous.filter((e) => !(e.from === "video-service" && e.to === "transcode-job"));
    const problem = checkNoDroppedExtendedEdges(previous, baseIds, { components: all, edges });
    expect(problem).toMatch(/"video-service" -> "transcode-job"/);
    expect(problem).toMatch(/dropped or reversed 1 existing edge /);
  });

  it("flags a REVERSED edge — the original direction is missing even though a reverse exists", () => {
    const edges = previous.map((e) => (e.from === "video-service" && e.to === "object-storage" ? { from: e.to, to: e.from } : e));
    const problem = checkNoDroppedExtendedEdges(previous, baseIds, { components: all, edges });
    expect(problem).toMatch(/"video-service" -> "object-storage"/);
  });

  it("lists several at once and pluralizes", () => {
    const problem = checkNoDroppedExtendedEdges(previous, baseIds, { components: all, edges: [] });
    expect(problem).toMatch(/dropped or reversed 4 existing edges/);
    expect(problem).toMatch(/restore them/);
  });

  it("exempts edges whose extended end was legitimately removed", () => {
    const remaining = ext("object-storage", "cdn"); // transcode-job removed on purpose
    const edges = previous.filter((e) => e.from !== "transcode-job" && e.to !== "transcode-job");
    expect(checkNoDroppedExtendedEdges(previous, baseIds, { components: remaining, edges })).toBeNull();
  });

  it("exempts edges whose base end no longer exists (the rework replaced that component)", () => {
    const edges = previous.filter((e) => e.from !== "video-service" && e.to !== "video-service");
    const problem = checkNoDroppedExtendedEdges(previous, new Set(["gateway"]), { components: all, edges });
    expect(problem).toBeNull();
  });

  it("has nothing to check on a first proposal", () => {
    expect(checkNoDroppedExtendedEdges([], baseIds, { components: all, edges: [] })).toBeNull();
  });
});

describe("reviseExtendedComponents keeps the existing wiring", () => {
  const previousEdges = [
    { from: "checkout-svc", to: "stripe-api" },
    { from: "gw", to: "stripe-api" },
  ];
  const keepAll = { components: [stripeComponent], edges: previousEdges };
  const dropOne = { components: [stripeComponent], edges: [previousEdges[0]!] };

  function capture(responses: Anthropic.Message[]) {
    const contents: string[] = [];
    const requests: { role: string; content: unknown }[][] = [];
    const inner = fakeClient(responses);
    const client = {
      messages: {
        create: async (params: unknown) => {
          const messages = (params as { messages: { role: string; content: unknown }[] }).messages;
          requests.push([...messages]);
          contents.push(JSON.stringify(messages[0]!.content));
          return (inner as unknown as { messages: { create: (p: unknown) => unknown } }).messages.create(params);
        },
      },
    } as unknown as Anthropic;
    return { client, contents, requests };
  }

  it("shows the model the existing edges, with their direction", async () => {
    const { client, contents } = capture([toolUseResponse(keepAll)]);
    await reviseExtendedComponents([stripeComponent as never], baseModel, { client }, undefined, previousEdges);

    expect(contents[0]).toContain("Existing edges touching them");
    expect(contents[0]).toContain('\\"from\\":\\"checkout-svc\\",\\"to\\":\\"stripe-api\\"');
  });

  it("omits that section when there are no existing edges", async () => {
    const { client, contents } = capture([toolUseResponse(keepAll)]);
    await reviseExtendedComponents([stripeComponent as never], baseModel, { client });
    expect(contents[0]).not.toContain("Existing edges touching them");
  });

  it("rejects a result that drops an existing edge and retries — telling the model which one", async () => {
    const { client, requests } = capture([toolUseResponse(dropOne), toolUseResponse(keepAll)]);
    const result = await reviseExtendedComponents([stripeComponent as never], baseModel, { client }, undefined, previousEdges);

    expect(result.edges).toEqual(previousEdges);
    expect(requests).toHaveLength(2);
    // The second request is the repair, and its tool_result carries the complaint.
    const repairTurn = JSON.stringify(requests[1]![2]!.content);
    expect(repairTurn).toContain("is_error");
    expect(repairTurn).toContain('\\"gw\\" -> \\"stripe-api\\"');
  });

  it("throws once retries are exhausted by dropped edges alone", async () => {
    const { client } = capture([toolUseResponse(dropOne), toolUseResponse(dropOne), toolUseResponse(dropOne)]);
    await expect(
      reviseExtendedComponents([stripeComponent as never], baseModel, { client }, undefined, previousEdges),
    ).rejects.toThrow(/dropped or reversed 1 existing edge/);
  });

  it("does not demand edges on a first-time call with nothing to keep", async () => {
    const { client } = capture([toolUseResponse({ components: [stripeComponent], edges: [] })]);
    const result = await reviseExtendedComponents([], baseModel, { client });
    expect(result.components).toHaveLength(1);
  });

  it("the prompt makes instance counts the revise step's own job, sized from the scale it's told", () => {
    expect(REVISE_PROMPT).toMatch(/Instance counts are yours to keep right, automatically/);
    expect(REVISE_PROMPT).toMatch(/judge a load balancer's instanceCount from that scale using the tier groups/);
  });

  it("the prompt says direction is meaning and to keep every edge", () => {
    expect(REVISE_PROMPT).toMatch(/SAME DIRECTION/);
    expect(REVISE_PROMPT).toMatch(/never reverse one/i);
  });
});

describe("cdn direction in the prompts", () => {
  it("tells both the propose and the revise step that the edge runs from the CDN to its origin", async () => {
    const { PROPOSE_PROMPT, REVISE_PROMPT } = await import("../src/inference/extendedComponents.js");
    for (const prompt of [PROPOSE_PROMPT, REVISE_PROMPT]) {
      expect(prompt).toMatch(/edge runs FROM the CDN TO its origin/);
    }
  });
});

describe("edges into a CDN are turned around in code", () => {
  const cdn = {
    id: "edge-cdn",
    label: "Edge CDN",
    kind: "cdn",
    hasOriginShield: { rationale: "Origin sees every cache miss otherwise.", provenance: "default", value: false },
  };

  it("propose: an edge from the origin INTO the cdn comes out cdn -> origin, once, without a retry", async () => {
    const client = fakeClient([
      toolUseResponse({ components: [cdn], edges: [{ from: "checkout-svc", to: "edge-cdn" }, { from: "edge-cdn", to: "checkout-svc" }] }),
    ]);
    const result = await proposeExtendedComponents("a site with a CDN", baseModel, { client });
    expect(result.edges).toEqual([{ from: "edge-cdn", to: "checkout-svc" }]);
  });

  it("revise: the previous (backwards) edge is kept as shown, then corrected on the way out", async () => {
    const client = fakeClient([toolUseResponse({ components: [cdn], edges: [{ from: "checkout-svc", to: "edge-cdn" }] })]);
    const result = await reviseExtendedComponents([cdn as never], baseModel, { client }, undefined, [
      { from: "checkout-svc", to: "edge-cdn" },
    ]);
    expect(result.edges).toEqual([{ from: "edge-cdn", to: "checkout-svc" }]);
  });

  it("leaves every other edge alone, including one from another extended component", async () => {
    const client = fakeClient([
      toolUseResponse({ components: [cdn, stripeComponent], edges: [{ from: "checkout-svc", to: "stripe-api" }, { from: "edge-cdn", to: "checkout-svc" }] }),
    ]);
    const result = await proposeExtendedComponents("payments and a CDN", baseModel, { client });
    expect(result.edges).toEqual([{ from: "checkout-svc", to: "stripe-api" }, { from: "edge-cdn", to: "checkout-svc" }]);
  });
});

describe("checkNoDroppedExtendedEdges: the connection must survive, not the literal edge", () => {
  const baseIds = new Set(["index-service", "ingest-queue"]);
  const job = [{ id: "crawler-job" }];

  it("accepts a direct edge replaced by a path through a base queue (the base call's own edge completes it)", () => {
    const previous = [{ from: "crawler-job", to: "index-service" }];
    const result = { components: job, edges: [{ from: "crawler-job", to: "ingest-queue" }] };
    const baseEdges = [{ from: "ingest-queue", to: "index-service" }];
    expect(checkNoDroppedExtendedEdges(previous, baseIds, result, baseEdges)).toBeNull();
  });

  it("still flags the edge when nothing else connects the two ends, and reports a doubled edge once", () => {
    const previous = [{ from: "crawler-job", to: "index-service" }, { from: "crawler-job", to: "index-service" }];
    const problem = checkNoDroppedExtendedEdges(previous, baseIds, { components: job, edges: [] }, [
      { from: "ingest-queue", to: "index-service" },
    ]);
    expect(problem).toMatch(/dropped or reversed 1 existing edge/);
  });

  it("does not let a path in the wrong direction count", () => {
    const previous = [{ from: "crawler-job", to: "index-service" }];
    const result = { components: job, edges: [{ from: "index-service", to: "crawler-job" }] };
    expect(checkNoDroppedExtendedEdges(previous, baseIds, result)).toMatch(/dropped or reversed/);
  });
});

describe("the revise step shares the same tier groups", () => {
  it("includes them, so the base and extended steps never disagree about what a tier means", () => {
    expect(REVISE_PROMPT).toContain("Tier groups, as guidance for your own judgement");
    expect(REVISE_PROMPT).toContain("Highest tier (100,000,000 users");
  });

  // Regression test for a confirmed-live bug: a real project (multiple service instances,
  // scaled from 100 to 100M users across four Re-simulates) never gained a load balancer at
  // any tier, because "cannot work at its current scale without it" had no concrete anchor -
  // the tier guide's own "a load balancer runs multiple" line only covers an EXISTING one's
  // instance count, never when to create one in the first place. Not load-balancer-specific:
  // the same project's topology never changed AT ALL across four tier jumps, so the fix
  // recalibrates the threshold itself (read as an architect launching this would, not as a
  // literal "would it still technically run" test) and keeps the load balancer case as one
  // worked example, not the only one — the identical pair of sentences is also in
  // reworkModel.ts's REWORK_PROMPT for the five base kinds (see reworkModel.test.ts).
  it("recalibrates 'cannot work without it' to an architect's judgment, not a literal uptime test, with the load balancer case as one example among several extended kinds", () => {
    expect(REVISE_PROMPT).toMatch(/the way an architect actually launching this system at this scale would, not as a literal test of whether it would still run in some degraded way/);
    expect(REVISE_PROMPT).toMatch(/two or more instances of that service with nothing distributing traffic across them is exactly that gap/);
    expect(REVISE_PROMPT).toMatch(/The same standard applies to any other extended kind the system's own described load has genuinely outgrown/);
  });

  // The deeper bug the prompt wording alone couldn't fix, found only by actually running it
  // live: BaseComponentRef (and baseComponentContext, which builds what the AI is shown)
  // stripped every trait down to id/label/kind, so this step had no way to see that a service
  // had already gone "multiple" — the prompt guidance above had nothing to act on. Confirmed
  // live before this fix: a real rework correctly split an overloaded shared database (the
  // REWORK_PROMPT guidance for base kinds DOES see instance counts) but never added a load
  // balancer for services already at "multiple", across four tier jumps to 100M users.
  it("actually shows the AI which base services are already multiple-instance, not just the guidance to act on it", async () => {
    const withInstanceCount = {
      components: [
        { id: "gw", label: "API Gateway", kind: "gateway" as const },
        {
          id: "order-svc",
          label: "Order Service",
          kind: "service" as const,
          instanceCount: { value: "multiple", rationale: "Massive scale.", provenance: "inferred" as const },
        },
      ],
    };
    const requests: { messages: { content: unknown }[] }[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          requests.push(params as { messages: { content: unknown }[] });
          return toolUseResponse({ components: [], edges: [] });
        },
      },
    } as unknown as Anthropic;
    await reviseExtendedComponents([], withInstanceCount, { client });
    const sent = JSON.stringify(requests[0]!.messages[0]!.content);
    expect(sent).toContain('\\"id\\":\\"order-svc\\"');
    expect(sent).toContain('\\"instanceCount\\":\\"multiple\\"');
    // The gateway has no instanceCount trait at all - confirms this is really reading each
    // component's own value, not stamping every component with one regardless.
    expect(sent).not.toMatch(/"id":"gw"[^}]*instanceCount/);
  });
});

describe("extended kinds also start without protections", () => {
  it("the propose prompt keeps timeouts, fallbacks, shielding, versioning and locking off unless the description says otherwise", () => {
    expect(PROPOSE_PROMPT).toMatch(/no protections - a timeout, a fallback, origin shielding, versioning, locking/);
  });
});

describe("load balancer placement in the prompts", () => {
  it("tells both steps a NEW balancer sits between its callers and the service, and that an existing one keeps its connections", () => {
    for (const prompt of [PROPOSE_PROMPT, REVISE_PROMPT]) {
      expect(prompt).toMatch(/ADD a load balancer it sits BETWEEN its callers and what it balances: edges run caller -> load balancer -> service/);
      expect(prompt).toMatch(/already in the system keeps the connections it has/);
    }
  });
});

describe("existing extended components must survive a revision unless removal was requested", () => {
  const cdn = {
    id: "edge-cdn", label: "Edge CDN", kind: "cdn",
    hasOriginShield: { rationale: "No shielding described for the origin.", provenance: "default", value: false },
  };

  it("checkNoDroppedExtendedComponents names exactly the missing ids, and is quiet when all are kept", () => {
    expect(checkNoDroppedExtendedComponents([{ id: "a" }, { id: "b" }], { components: [{ id: "a" }] })).toMatch(/dropped 1 existing extended component .*"b"/);
    expect(checkNoDroppedExtendedComponents([{ id: "a" }, { id: "b" }], { components: [] })).toMatch(/dropped 2 existing extended components without being asked to: "a", "b"/);
    expect(checkNoDroppedExtendedComponents([{ id: "a" }], { components: [{ id: "a" }, { id: "new" }] })).toBeNull();
  });

  it("revise: an empty answer with nothing queued is rejected and the retry that restores them is accepted", async () => {
    const client = fakeClient([
      toolUseResponse({ components: [], edges: [] }),
      toolUseResponse({ components: [cdn], edges: [{ from: "edge-cdn", to: "checkout-svc" }] }),
    ]);
    const result = await reviseExtendedComponents([cdn as never], baseModel, { client }, undefined, [{ from: "edge-cdn", to: "checkout-svc" }]);
    expect(result.components.map((c) => c.id)).toEqual(["edge-cdn"]);
  });

  it("revise: with a request queued the same empty answer is accepted (the request may be to remove it)", async () => {
    const client = fakeClient([toolUseResponse({ components: [], edges: [] })]);
    const result = await reviseExtendedComponents([cdn as never], baseModel, { client }, "Remove the CDN.", [], true);
    expect(result.components).toEqual([]);
  });
});

describe("the revise step lists what it keeps instead of re-emitting it", () => {
  const cdn = {
    id: "edge-cdn", label: "Edge CDN", kind: "cdn",
    hasOriginShield: { rationale: "No shielding described for the origin.", provenance: "default", value: false },
  };
  const lb = {
    id: "api-lb", label: "API LB", kind: "load-balancer",
    instanceCount: { rationale: "At 10,000 users one balancer is enough.", provenance: "default", value: "single" },
    hasHealthChecks: { rationale: "Not part of the described system.", provenance: "default", value: false },
  };
  const both = [cdn, lb] as never[];
  const prevEdges = [{ from: "edge-cdn", to: "checkout-svc" }, { from: "api-lb", to: "gw" }];

  it("a kept component is taken from the previous list unchanged, and only the changed one is returned in full", () => {
    const changedLb = { ...lb, instanceCount: { rationale: "At 1,000,000 users the balancer runs several instances.", provenance: "inferred", value: "multiple" } };
    const { components, problem } = mergeRevision(both, { keep: ["edge-cdn"], remove: [], components: [changedLb], edges: [] } as never, false);
    expect(problem).toBeNull();
    expect(components.map((c) => c.id)).toEqual(["edge-cdn", "api-lb"]);
    expect((components[1] as unknown as { instanceCount: { value: string } }).instanceCount.value).toBe("multiple");
  });

  it.each([
    ["an id that was never a previous component", { keep: ["ghost"], remove: [], components: [] }, /not previous ones: "ghost"/],
    ["an id both kept and returned", { keep: ["edge-cdn"], remove: [], components: [cdn] }, /exactly ONE of keep/],
    ["a previous component mentioned nowhere (the wipe)", { keep: ["edge-cdn"], remove: [], components: [] }, /dropped 1 existing extended component .*"api-lb"/],
    ["a removal nobody asked for", { keep: ["edge-cdn"], remove: ["api-lb"], components: [] }, /dropped 1 existing extended component .*"api-lb"/],
  ])("rejects %s", (_label, data, message) => {
    expect(mergeRevision(both, { edges: [], ...data } as never, false).problem).toMatch(message);
  });

  it("accepts a removal when a request may have asked for it", () => {
    const merged = mergeRevision(both, { keep: ["edge-cdn"], remove: ["api-lb"], components: [], edges: [] } as never, true);
    expect(merged.problem).toBeNull();
    expect(merged.components.map((c) => c.id)).toEqual(["edge-cdn"]);
  });

  it("revise end to end: a response that keeps one component and returns another gives the full merged list", async () => {
    const client = fakeClient([toolUseResponse({ keep: ["edge-cdn"], remove: [], components: [lb], edges: prevEdges })]);
    const result = await reviseExtendedComponents(both, baseModel, { client }, undefined, prevEdges);
    expect(result.components.map((c) => c.id).sort()).toEqual(["api-lb", "edge-cdn"]);
    expect(result.edges).toEqual(prevEdges);
  });

  it("revise end to end: an inconsistent response is rejected with the reason and the corrected one accepted", async () => {
    const client = fakeClient([
      toolUseResponse({ keep: ["edge-cdn"], remove: [], components: [], edges: prevEdges }), // api-lb mentioned nowhere
      toolUseResponse({ keep: ["edge-cdn", "api-lb"], remove: [], components: [], edges: prevEdges }),
    ]);
    const result = await reviseExtendedComponents(both, baseModel, { client }, undefined, prevEdges);
    expect(result.components.map((c) => c.id).sort()).toEqual(["api-lb", "edge-cdn"]);
  });

  it("the prompt explains the three places a previous component can go, and ties keep to rationales that are still true", () => {
    expect(REVISE_PROMPT).toMatch(/goes in exactly one place/);
    expect(REVISE_PROMPT).toMatch(/"keep": the ids you leave EXACTLY as they are - and only when every rationale it carries is still true at the current scale/);
  });

  it("the prompt requires deciding all seven kinds first, same discipline as a build", () => {
    expect(REVISE_PROMPT).toMatch(/first decide, for EACH of the 7 kinds in "considered", whether this system needs one NOW/);
    expect(REVISE_PROMPT).toMatch(/keeping a kind it already has counts as needed/);
  });
});

describe("the revise step also decides each kind before listing components — the same bug class as the propose step, confirmed live for THIS step too", () => {
  const decision = (kind: string, needed: boolean) => ({ kind, needed, evidence: needed ? "Still needed." : "Not needed." });
  const all = (neededKinds: string[]) => EXTENDED_KINDS.map((k) => decision(k, neededKinds.includes(k)));
  const lbComponent = {
    id: "api-lb", label: "API Load Balancer", kind: "load-balancer",
    instanceCount: { rationale: "Massive scale.", provenance: "inferred", value: "multiple" },
    hasHealthChecks: { rationale: "Baseline at this scale.", provenance: "inferred", value: true },
  };
  const multiInstanceBase = {
    components: [
      { id: "gw", label: "API Gateway", kind: "gateway" as const },
      { id: "svc", label: "Order Service", kind: "service" as const, instanceCount: { value: "multiple" } },
    ],
  };

  it("checkReviseDecisionsMatchComponents: quiet when kept+returned agree with the decisions, names the disagreement either way", () => {
    expect(checkReviseDecisionsMatchComponents({ considered: all(["load-balancer"]) as never, components: [lbComponent as never], keep: [] }, [])).toBeNull();
    // Kept (not re-returned) still counts as present - a "needed: true" for a kept kind is not a disagreement.
    expect(checkReviseDecisionsMatchComponents({ considered: all(["load-balancer"]) as never, components: [], keep: ["api-lb"] }, [lbComponent as never])).toBeNull();
    expect(checkReviseDecisionsMatchComponents({ considered: all([]) as never, components: [lbComponent as never], keep: [] }, [])).toMatch(/kept or returned load-balancer without deciding it is needed/);
    expect(checkReviseDecisionsMatchComponents({ considered: all(["load-balancer"]) as never, components: [], keep: [] }, [])).toMatch(/load-balancer is needed but it's neither kept nor returned/);
  });

  // The actual confirmed-live bug, reproduced at the schema level: before "considered"
  // existed on this step's schema, a scale change that genuinely called for a NEW load
  // balancer (services already multiple-instance, nothing distributing traffic across them)
  // could return an empty revision with no load balancer and no stated reason - nothing in
  // the schema forced a yes/no, so skipping the question looked identical to answering "no"
  // to it. This reproduces that exact shape of self-contradiction (decided "needed", returned
  // nothing) now that "considered" exists, and confirms it is rejected and retried rather than
  // silently accepted.
  it("deciding a load balancer is needed but returning none is rejected with the reason, and the corrected answer accepted", async () => {
    const client = fakeClient([
      toolUseResponse({ considered: all(["load-balancer"]), keep: [], remove: [], components: [], edges: [] }),
      toolUseResponse({ considered: all(["load-balancer"]), keep: [], remove: [], components: [lbComponent], edges: [{ from: "gw", to: "api-lb" }, { from: "api-lb", to: "svc" }] }),
    ]);
    const result = await reviseExtendedComponents([], multiInstanceBase, { client });
    expect(result.components.map((c) => c.kind)).toContain("load-balancer");
  });

  // The schema-level guarantee a live, strict-mode call actually depends on: "considered" is
  // a required field with exactly 7 entries, so a response cannot omit it or decide a subset -
  // unlike before this fix, skipping the load-balancer question is no longer representable.
  it("the tool schema requires 'considered' with all 7 kinds, so a live call cannot omit it", () => {
    const schema = buildExtendedToolInputSchema(ReviseResponseSchema) as {
      required?: string[];
      properties: Record<string, { items?: { properties?: Record<string, unknown> } }>;
    };
    expect(schema.required).toContain("considered");
    expect(schema.properties.considered?.items?.properties).toHaveProperty("kind");
    expect(schema.properties.considered?.items?.properties).toHaveProperty("needed");
  });
});

describe("the propose step decides each kind before listing components", () => {
  const decision = (kind: string, needed: boolean) => ({ kind, needed, evidence: needed ? "The description names it." : "Not needed." });
  const all = (neededKinds: string[]) => EXTENDED_KINDS.map((k) => decision(k, neededKinds.includes(k)));
  const cdn = {
    id: "video-cdn", label: "Video CDN", kind: "cdn",
    hasOriginShield: { rationale: "No shielding described for the origin.", provenance: "default", value: false },
  };

  it("checkDecisionsMatchComponents: quiet when they agree, and names the disagreement either way", () => {
    expect(checkDecisionsMatchComponents({ considered: all(["cdn"]) as never, components: [{ kind: "cdn" }] })).toBeNull();
    expect(checkDecisionsMatchComponents({ considered: all(["cdn", "object-storage"]) as never, components: [{ kind: "cdn" }] })).toMatch(/object-storage is needed but returned no such component/);
    expect(checkDecisionsMatchComponents({ considered: all([]) as never, components: [{ kind: "cdn" }] })).toMatch(/returned cdn without deciding it is needed/);
  });

  it("an empty list that contradicts a 'needed' decision is rejected with the reason, and the corrected answer accepted", async () => {
    const client = fakeClient([
      toolUseResponse({ considered: all(["cdn"]), components: [], edges: [] }), // the live failure, but now self-contradictory
      toolUseResponse({ considered: all(["cdn"]), components: [cdn], edges: [{ from: "video-cdn", to: "checkout-svc" }] }),
    ]);
    const result = await proposeExtendedComponents("a site whose video is served through a CDN", baseModel, { client });
    expect(result.components.map((c) => c.id)).toEqual(["video-cdn"]);
  });

  it("an empty answer backed by seven 'no' decisions is accepted (a system that needs none)", async () => {
    const client = fakeClient([toolUseResponse({ considered: all([]), components: [], edges: [] })]);
    const result = await proposeExtendedComponents("a plain CRUD app", baseModel, { client });
    expect(result.components).toEqual([]);
  });

  it("the schema wants exactly one decision per kind", async () => {
    const client = fakeClient([
      toolUseResponse({ considered: [decision("cdn", true)], components: [cdn], edges: [{ from: "video-cdn", to: "checkout-svc" }] }),
      toolUseResponse({ considered: all(["cdn"]), components: [cdn], edges: [{ from: "video-cdn", to: "checkout-svc" }] }),
    ]);
    const result = await proposeExtendedComponents("a site with a CDN", baseModel, { client });
    expect(result.components).toHaveLength(1);
  });

  it("the prompt asks for a decision on each kind first, and says a named kind has been stated", () => {
    expect(PROPOSE_PROMPT).toMatch(/first decide, for EACH of the 7 kinds in "considered"/);
    expect(PROPOSE_PROMPT).toMatch(/an answer that lists no components must come from seven considered "no" decisions/);
    expect(PROPOSE_PROMPT).toMatch(/a description that NAMES one .* has stated it - include it/);
  });
});
