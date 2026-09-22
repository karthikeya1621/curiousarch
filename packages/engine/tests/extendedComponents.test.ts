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
