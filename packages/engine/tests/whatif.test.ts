/**
 * What-if scenarios: relative perturbations to a model, diffed against its
 * own baseline via the same `simulate()` the golden tests hold to a
 * hand-derived standard. Expected values here are computed on paper from
 * the reference models' own stated numbers, not captured from a run.
 */

import { describe, expect, it } from "vitest";
import { listScenarios, applyScenario, compareScenario, setParameterValue } from "../src/whatif.js";
import { checkout, urlShortener, mediaUpload } from "../models/reference.js";

describe("listScenarios", () => {
  it("generates one scenario set per component kind present", () => {
    const ids = listScenarios(checkout).map((s) => s.id);
    // checkout: gateway (none), service, database — no cache, no queue.
    expect(ids).toContain("svc:instance-loss-50");
    expect(ids).toContain("svc:latency-spike-2x");
    expect(ids).toContain("db:query-latency-2x");
    expect(ids).toContain("db:pool-shrink-50");
    expect(ids).toContain("db:write-spike-2x");
    expect(ids.some((id) => id.startsWith("gw:"))).toBe(false);
    expect(ids.some((id) => id.includes("cache") || id.includes("consumer"))).toBe(false);
  });

  it("includes traffic scenarios scaled to the model's own workload", () => {
    const scenarios = listScenarios(checkout);
    const tenX = scenarios.find((s) => s.id === "workload:traffic-10x")!;
    expect(tenX.label).toContain("5,000 rps"); // 500 * 10
  });

  it("includes a 6x traffic scenario alongside 2x/5x/10x", () => {
    // 6x exists specifically because it's the only multiplier that lands a
    // reference model (url-shortener's service) in a HIGH_UTILIZATION
    // warning without saturating anything — see compareScenario's own test
    // below for the hand-derived numbers.
    const ids = listScenarios(checkout).map((s) => s.id);
    expect(ids).toContain("workload:traffic-6x");
  });

  it("offers cache-specific scenarios only for models with a cache", () => {
    expect(listScenarios(urlShortener).map((s) => s.id)).toContain("cache:cold");
    expect(listScenarios(checkout).map((s) => s.id)).not.toContain("cache:cold");
  });

  it("offers queue-specific scenarios only for models with a queue", () => {
    expect(listScenarios(mediaUpload).map((s) => s.id)).toContain("queue:consumer-loss-50");
    expect(listScenarios(checkout).map((s) => s.id)).not.toContain("queue:consumer-loss-50");
  });
});

describe("applyScenario", () => {
  it("halves instances without mutating the original model", () => {
    const patched = applyScenario(checkout, "svc:instance-loss-50");
    const svc = patched.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instances.value).toBe(4); // 8 / 2

    const originalSvc = checkout.components.find((c) => c.id === "svc");
    if (originalSvc?.kind !== "service") throw new Error("expected service");
    expect(originalSvc.instances.value).toBe(8); // unchanged
  });

  it("doubles query time for a database scenario", () => {
    const patched = applyScenario(checkout, "db:query-latency-2x");
    const db = patched.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.queryTimeMs.value).toBe(50); // 25 * 2
  });

  it("throws on an unknown scenario id", () => {
    expect(() => applyScenario(checkout, "nope")).toThrow(/unknown scenario/i);
  });

  it("rejects a scenario that doesn't apply to this model's components", () => {
    // checkout has no cache; a cache scenario id must not resolve against it.
    expect(() => applyScenario(checkout, "cache:cold")).toThrow(/unknown scenario/i);
  });
});

describe("setParameterValue", () => {
  it("sets the new value and marks it stated, without mutating the original", () => {
    const patched = setParameterValue(checkout, "db", "queryTimeMs", 40);
    const db = patched.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.queryTimeMs.value).toBe(40);
    expect(db.queryTimeMs.provenance).toBe("stated");

    const originalDb = checkout.components.find((c) => c.id === "db");
    if (originalDb?.kind !== "database") throw new Error("expected database");
    expect(originalDb.queryTimeMs.value).toBe(25); // unchanged
  });

  it("preserves the rationale and unit while overwriting value and provenance", () => {
    const patched = setParameterValue(checkout, "db", "queryTimeMs", 40);
    const db = patched.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    const original = checkout.components.find((c) => c.id === "db");
    if (original?.kind !== "database") throw new Error("expected database");
    expect(db.queryTimeMs.unit).toBe(original.queryTimeMs.unit);
    expect(db.queryTimeMs.rationale).toBe(original.queryTimeMs.rationale);
  });

  it("throws when the field isn't a parameter on that component", () => {
    expect(() => setParameterValue(checkout, "db", "kind", 1)).toThrow(/not a parameter/i);
  });
});

describe("compareScenario", () => {
  it("flags a scenario that breaks a previously healthy system", () => {
    // Checkout at its stated 500 rps is healthy; 10x traffic (5,000 rps)
    // is far past its 1,600 rps pool-bound capacity.
    const delta = compareScenario(checkout, "workload:traffic-10x");
    expect(delta.baseline.healthy).toBe(true);
    expect(delta.newlyUnhealthy).toBe(true);
    expect(delta.underScenario.healthy).toBe(false);
    expect(delta.newFindingCodes).toContain("CONNECTION_POOL_EXHAUSTED");
  });

  it("surfaces a warning while staying healthy — the early-indicator case", () => {
    // url-shortener's service: 20 instances * 50 concurrency = 1,000
    // servers at 15ms => 66,666.67 rps capacity (golden.test.ts). At 6x
    // traffic (60,000 rps), utilization is exactly 60000 / 66666.67 = 0.9
    // — past the 0.8 HIGH_UTILIZATION threshold but nowhere near
    // saturated. Nothing else on this model moves: the whole point of this
    // scenario existing (see listScenarios' test above) is a model that's
    // still healthy but says something before it breaks.
    const delta = compareScenario(urlShortener, "workload:traffic-6x");
    expect(delta.baseline.healthy).toBe(true);
    expect(delta.underScenario.healthy).toBe(true);
    expect(delta.newlyUnhealthy).toBe(false);
    expect(delta.newFindingCodes).toEqual(["HIGH_UTILIZATION"]);
  });

  it("reports no new findings when a scenario doesn't move the needle", () => {
    // Checkout has ~3.2x headroom (1,600 / 500) before the pool exhausts;
    // halving connectionPoolSize (40 -> 20, capacity -> 800 rps) still
    // leaves headroom over the stated 500 rps load.
    const delta = compareScenario(checkout, "db:pool-shrink-50");
    expect(delta.baseline.healthy).toBe(true);
    expect(delta.underScenario.healthy).toBe(true);
    expect(delta.newlyUnhealthy).toBe(false);
  });

  it("computes the latency delta end to end", () => {
    // Doubling the order service's serviceTimeMs (40ms -> 80ms) at a load
    // nowhere near its own capacity should show up directly in mean latency,
    // roughly as an extra ~40ms end to end (service is on the critical path).
    const delta = compareScenario(checkout, "svc:latency-spike-2x");
    expect(delta.endToEndMeanDeltaMs).toBeGreaterThan(30);
    expect(delta.endToEndMeanDeltaMs).toBeLessThan(50);
  });

  it("leaves the original model and its baseline result untouched", () => {
    const before = JSON.stringify(checkout);
    compareScenario(checkout, "workload:traffic-10x");
    expect(JSON.stringify(checkout)).toBe(before);
  });
});
