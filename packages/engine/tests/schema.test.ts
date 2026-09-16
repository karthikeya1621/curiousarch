/**
 * PLAN-0.1 acceptance: a hand-written JSON fixture — the shape an LLM's
 * structured output would actually produce — round-trips through
 * `SystemModelSchema` into a `SystemModel` that `simulate()` accepts.
 */

import { describe, expect, it } from "vitest";
import { SystemModelSchema } from "../src/inference/schema.js";
import { simulate } from "../src/solver.js";

/** Same topology as models/reference.ts's checkout system, as raw JSON. */
const fixture = {
  id: "checkout-fixture",
  name: "Checkout / order placement",
  workload: { rps: 500 },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      maxRps: {
        rationale: "No account-level ceiling was mentioned; assumed default.",
        provenance: "default",
        value: 50_000,
        unit: "rps",
      },
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instances: {
        rationale: "Prose stated eight running instances.",
        provenance: "stated",
        value: 8,
        unit: "count",
      },
      concurrencyPerInstance: {
        rationale: "No thread pool size given; assumed a common default.",
        provenance: "default",
        value: 25,
        unit: "count",
      },
      serviceTimeMs: {
        rationale: "Validation plus a synchronous payment call.",
        provenance: "inferred",
        value: 40,
        unit: "ms",
      },
    },
    {
      id: "db",
      label: "PostgreSQL (primary)",
      kind: "database",
      connectionPoolSize: {
        rationale: "Prose stated a pool of forty with no PgBouncer.",
        provenance: "stated",
        value: 40,
        unit: "count",
      },
      queryTimeMs: {
        rationale: "Multi-row transactional write.",
        provenance: "inferred",
        value: 25,
        unit: "ms",
      },
      writeRatio: {
        rationale: "Order inserts dominate this endpoint.",
        provenance: "stated",
        value: 0.9,
        unit: "ratio",
      },
      readReplicas: {
        rationale: "Prose mentioned two read replicas.",
        provenance: "stated",
        value: 2,
        unit: "count",
      },
      replicaApplyRate: {
        rationale: "Single-threaded logical apply, typical for Postgres.",
        provenance: "inferred",
        value: 800,
        unit: "ops",
      },
    },
  ],
  edges: [
    { from: "gw", to: "svc", callsPerRequest: 1 },
    { from: "svc", to: "db", callsPerRequest: 1 },
  ],
};

describe("SystemModelSchema", () => {
  it("parses a hand-written fixture into a SystemModel simulate() accepts", () => {
    const parsed = SystemModelSchema.parse(fixture);
    expect(() => simulate(parsed)).not.toThrow();

    const result = simulate(parsed);
    // Same numbers as the checkout golden test: 40 conns / 25ms = 1,600 RPS.
    const db = result.components.find((c) => c.componentId === "db")!;
    expect(Math.round(db.capacityRps)).toBe(1_600);
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
      edges: [...fixture.edges, { from: "db", to: "svc", callsPerRequest: 1 }],
    };
    const result = SystemModelSchema.safeParse(cyclic);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /cycle/i.test(i.message))).toBe(
        true,
      );
    }
  });

  it("rejects a parameter with no rationale", () => {
    const noRationale = {
      ...fixture,
      components: fixture.components.map((c) =>
        c.id === "svc" && c.kind === "service"
          ? { ...c, serviceTimeMs: { ...c.serviceTimeMs, rationale: "" } }
          : c,
      ),
    };
    expect(SystemModelSchema.safeParse(noRationale).success).toBe(false);
  });

  it("rejects an edge pointing at a component id that doesn't exist", () => {
    const danglingEdge = {
      ...fixture,
      edges: [...fixture.edges, { from: "svc", to: "cache", callsPerRequest: 1 }],
    };
    expect(SystemModelSchema.safeParse(danglingEdge).success).toBe(false);
  });
});
