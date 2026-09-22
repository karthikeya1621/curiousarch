/**
 * A hand-written JSON fixture — the shape an LLM's structured output would
 * actually produce — round-trips through `SystemModelSchema` into a valid
 * `SystemModel`.
 */

import { describe, expect, it } from "vitest";
import { STRUCTURAL_SELF_CHECK, SystemModelSchema } from "../src/inference/schema.js";
import { MAX_BASE_COMPONENTS } from "../src/types.js";

/** Same topology as models/reference.ts's checkout system, as raw JSON. */
const fixture = {
  id: "checkout-fixture",
  name: "Checkout / order placement",
  // Empty — SystemModelSchema's own workload field asks for nothing at
  // all now; see schema.ts's WorkloadSchema comment for why (workload
  // parameters are extracted by a separate call, workloadParameters.ts).
  workload: {},
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: {
        rationale: "Requests pass through a rate-limited API gateway.",
        provenance: "stated",
        value: true,
      },
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instanceCount: {
        rationale: "Eight instances behind a load balancer.",
        provenance: "stated",
        value: "multiple",
      },
      hasCircuitBreaker: {
        rationale: "No circuit breaker mentioned; the common default.",
        provenance: "default",
        value: false,
      },
    },
    {
      id: "db",
      label: "PostgreSQL (primary)",
      kind: "database",
      instanceCount: {
        rationale: "Two read replicas alongside the primary.",
        provenance: "stated",
        value: "has-replicas",
      },
      writeVolume: {
        rationale: "Order inserts dominate this endpoint's traffic.",
        provenance: "stated",
        value: "high",
      },
    },
  ],
  edges: [
    { from: "gw", to: "svc" },
    { from: "svc", to: "db" },
  ],
};

describe("SystemModelSchema", () => {
  it("parses a hand-written fixture into a well-formed SystemModel", () => {
    const parsed = SystemModelSchema.parse(fixture);
    expect(parsed.components).toHaveLength(fixture.components.length);
    expect(parsed.edges).toEqual(fixture.edges);
  });

  it("rejects a component kind the engine doesn't support", () => {
    const invalid = {
      ...fixture,
      components: [
        ...fixture.components,
        { id: "broker", label: "Message broker", kind: "message-broker" },
      ],
    };
    expect(SystemModelSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a cycle at parse time rather than letting the solver throw", () => {
    const cyclic = {
      ...fixture,
      edges: [...fixture.edges, { from: "db", to: "svc" }],
    };
    const result = SystemModelSchema.safeParse(cyclic);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /cycle/i.test(i.message))).toBe(
        true,
      );
    }
  });

  it("rejects a trait with no rationale", () => {
    const noRationale = {
      ...fixture,
      components: fixture.components.map((c) =>
        c.id === "svc"
          ? { ...c, hasCircuitBreaker: { ...c.hasCircuitBreaker, rationale: "" } }
          : c,
      ),
    };
    expect(SystemModelSchema.safeParse(noRationale).success).toBe(false);
  });

  it("rejects an edge pointing at a component id that doesn't exist", () => {
    const danglingEdge = {
      ...fixture,
      edges: [...fixture.edges, { from: "svc", to: "cache" }],
    };
    expect(SystemModelSchema.safeParse(danglingEdge).success).toBe(false);
  });

  it("rejects a model with only a gateway — nothing actually doing work", () => {
    // Found live: a bare-gateway model passed every other check and reached
    // the web app as a trivially "healthy" system for a prose description
    // that was clearly about more than admission control.
    const gatewayOnly = {
      ...fixture,
      components: fixture.components.filter((c) => c.kind === "gateway"),
      edges: [],
    };
    const result = SystemModelSchema.safeParse(gatewayOnly);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /beyond the entry point/i.test(i.message))).toBe(
        true,
      );
    }
  });

  it("rejects a model with more than MAX_BASE_COMPONENTS components", () => {
    // Guardrail against an unbounded (and increasingly expensive to
    // generate/re-generate) system — see types.ts's own comment on
    // MAX_BASE_COMPONENTS.
    const tooMany = {
      ...fixture,
      components: Array.from({ length: MAX_BASE_COMPONENTS + 1 }, (_, i) => ({
        ...fixture.components[1]!,
        id: `svc-${i}`,
      })),
      edges: [],
    };
    const result = SystemModelSchema.safeParse(tooMany);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /too many components/i.test(i.message))).toBe(true);
    }
  });

  it("rejects a trait rationale that's a throwaway placeholder instead of a real reason", () => {
    // Found live: an extended component occasionally got a real trait
    // value but a one-word "rationale" like "invalid" or "placeholder" —
    // meaningless text that still trivially satisfied a bare `.min(1)`.
    // traitSchema() (schema.ts) now rejects these outright.
    for (const placeholder of ["invalid", "placeholder", "n/a", "TBD", "Unknown"]) {
      const bad = {
        ...fixture,
        components: fixture.components.map((c) =>
          c.id === "gw" ? { ...c, hasRateLimiting: { ...c.hasRateLimiting, rationale: placeholder } } : c,
        ),
      };
      const result = SystemModelSchema.safeParse(bad);
      expect(result.success, `expected "${placeholder}" to be rejected`).toBe(false);
    }
  });

  it("rejects a placeholder rationale without echoing the banned word back as the category label", () => {
    // Regression test: the validation message used to read `"placeholder"
    // is a placeholder, not a reason` — which, fed back to the model as
    // repair-retry feedback, doubled the exact banned word right before
    // asking it to fix the field. Confirmed live: the model then reproduced
    // the identical word on the very next attempt for the same field. The
    // model's own bad value may still be quoted (useful for debugging), but
    // the word describing the CATEGORY of "wrong" must never be the same
    // banned word — that's the specific thing that backfired.
    const bad = {
      ...fixture,
      components: fixture.components.map((c) =>
        c.id === "gw" ? { ...c, hasRateLimiting: { ...c.hasRateLimiting, rationale: "placeholder" } } : c,
      ),
    };
    const result = SystemModelSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(" ");
      expect(message).toContain('"placeholder"'); // the bad value itself, quoted — fine
      expect(message.toLowerCase()).not.toMatch(/is a placeholder/); // NOT as the category label
    }
  });

  it("still accepts a short but genuine rationale", () => {
    const ok = {
      ...fixture,
      components: fixture.components.map((c) =>
        c.id === "gw" ? { ...c, hasRateLimiting: { ...c.hasRateLimiting, rationale: "Stated in the prose." } } : c,
      ),
    };
    expect(SystemModelSchema.safeParse(ok).success).toBe(true);
  });
});

describe("STRUCTURAL_SELF_CHECK", () => {
  // Not a golden-text snapshot of the exact wording — that would just make
  // this test brittle to phrasing tweaks. What has to hold is narrower: it
  // names each of the four failure classes above that strict mode's JSON
  // Schema literally cannot express and only this file's own superRefine
  // catches, since those are exactly the ones a repair-retry can't be
  // prevented for any other way (see reworkModel.ts's own comment on why
  // this is interpolated into its prompt).
  it("names all four superRefine-only failure classes: duplicate ids, dangling edges, cycles, placeholder rationale", () => {
    expect(STRUCTURAL_SELF_CHECK).toMatch(/id/i);
    expect(STRUCTURAL_SELF_CHECK).toMatch(/edge/i);
    expect(STRUCTURAL_SELF_CHECK).toMatch(/cycle/i);
    expect(STRUCTURAL_SELF_CHECK).toMatch(/rationale/i);
  });

  // Confirmed live: naming the exact banned word ("placeholder") as the
  // example of a bad rationale measurably backfires — the model reached for
  // that literal word, including reproducing it on a retry immediately
  // after a repair message that also named it (see this constant's own doc
  // comment). Any of PLACEHOLDER_RATIONALES appearing here would silently
  // reintroduce that bug — this is the regression test for it, not a
  // stylistic preference.
  it("never spells out any of the banned rationale words as an example — only describes the category, to avoid priming the model to reproduce one", () => {
    const text = STRUCTURAL_SELF_CHECK.toLowerCase();
    // Only the distinctive ones — "none"/"unknown"/"test"/"example" are also
    // in PLACEHOLDER_RATIONALES but are ordinary English words too common to
    // ban as a substring of arbitrary prompt prose without false positives.
    for (const word of ["placeholder", "lorem ipsum", "tbd", "n/a"]) {
      expect(text).not.toContain(word);
    }
  });
});
