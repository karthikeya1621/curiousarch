/**
 * A hand-written JSON fixture — the shape an LLM's structured output would
 * actually produce — round-trips through `SystemModelSchema` into a
 * `SystemModel` that `simulate()` accepts.
 */

import { describe, expect, it } from "vitest";
import { SystemModelSchema } from "../src/inference/schema.js";
import { simulate } from "../src/solver.js";

/** Same topology as models/reference.ts's checkout system, as raw JSON. */
const fixture = {
  id: "checkout-fixture",
  name: "Checkout / order placement",
  workload: {
    scale: {
      rationale: "A single-region order-placement API, not yet at wide scale.",
      provenance: "stated",
      value: "small",
    },
  },
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
  it("parses a hand-written fixture into a SystemModel simulate() accepts", () => {
    const parsed = SystemModelSchema.parse(fixture);
    expect(() => simulate(parsed)).not.toThrow();

    // No circuit breaker on a 3-deep synchronous chain — the same
    // cascading-failure risk the golden test asserts for the real model.
    const result = simulate(parsed);
    expect(result.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");
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
    // Found live: a bare-gateway model passes every other check and reaches
    // simulate() as a trivially "healthy" system for a prose description
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
});
