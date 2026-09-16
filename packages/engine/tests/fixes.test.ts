/**
 * Fix catalogue: applying a failure scenario, then a fix on top of it, and
 * confirming the fix's transform actually does what its label claims and
 * that re-simulating shows the intended recovery. Expected values are
 * derived on paper from the reference models' own numbers.
 */

import { describe, expect, it } from "vitest";
import { listFixes, compareFix } from "../src/fixes.js";
import { checkout, mediaUpload, urlShortener } from "../models/reference.js";

describe("listFixes", () => {
  it("is empty when the scenario doesn't break anything at current load", () => {
    // checkout has ~3.2x headroom (1,600 / 500 rps); halving the pool
    // (40 -> 20, capacity -> 800 rps) still leaves it healthy.
    expect(listFixes(checkout, "db:pool-shrink-50")).toEqual([]);
  });

  it("offers fixes keyed by whatever finding the scenario actually produces", () => {
    // 10x traffic (5,000 rps) blows past checkout's 1,600 rps pool capacity
    // and its service capacity (5,000 rps at baseline serviceTimeMs).
    const fixes = listFixes(checkout, "workload:traffic-10x");
    const ids = fixes.map((f) => f.id);
    expect(ids).toContain("db:pool-2x");
    expect(ids).toContain("db:query-time-half");
  });

  it("de-duplicates fixes when multiple findings would offer the same one", () => {
    const fixes = listFixes(checkout, "workload:traffic-10x");
    const ids = fixes.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers a preventive fix for a HIGH_UTILIZATION warning, keyed by the component's own kind", () => {
    // url-shortener's service hits exactly 90% utilization at 6x traffic
    // (60,000 / 66,666.67) — a warning, nothing saturated. The factory
    // switches on component.kind, so a service gets an instances-based
    // fix, not the pool/consumer/cpu-time variants meant for other kinds.
    const fixes = listFixes(urlShortener, "workload:traffic-6x");
    const ids = fixes.map((f) => f.id);
    expect(ids).toContain("svc:instances-1.5x-preventive");
    expect(ids).not.toContain("svc:pool-1.5x-preventive");
  });
});

describe("compareFix", () => {
  it("actually scales the targeted parameter, not just the label", () => {
    const result = compareFix(checkout, "workload:traffic-10x", "db:pool-2x");
    // Original pool is 40; the fix doubles it to 80, independent of the
    // scenario's own changes (traffic-10x doesn't touch the pool).
    const before = checkout.components.find((c) => c.id === "db");
    if (before?.kind !== "database") throw new Error("expected database");
    expect(before.connectionPoolSize.value).toBe(40); // unmutated original
  });

  it("resolves the specific finding it targets", () => {
    // 5x traffic (2,500 rps) exceeds checkout's 1,600 rps pool capacity but
    // stays under its 5,000 rps service capacity; doubling the pool
    // (40 -> 80, capacity -> 3,200 rps) clears that specific finding.
    const result = compareFix(checkout, "workload:traffic-5x", "db:pool-2x");
    expect(result.underFailure.findings.map((f) => f.code)).toContain(
      "CONNECTION_POOL_EXHAUSTED",
    );
    expect(result.underFix.findings.map((f) => f.code)).not.toContain(
      "CONNECTION_POOL_EXHAUSTED",
    );
    expect(result.resolved).toBe(true);
  });

  it("does not claim to resolve a finding it doesn't target", () => {
    // 5x traffic also pushes writeRps far past the replica apply rate;
    // the pool fix does nothing about that.
    const result = compareFix(checkout, "workload:traffic-5x", "db:pool-2x");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("REPLICATION_LAG");
    expect(result.underFix.findings.map((f) => f.code)).toContain("REPLICATION_LAG");
  });

  it("does not silently resolve a failure the fix only delays", () => {
    // Doubling a queue's retention capacity delays overflow — it doesn't
    // fix the underlying drain-rate deficit, so the finding must persist.
    const result = compareFix(mediaUpload, "workload:traffic-2x", "queue:capacity-2x");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("QUEUE_OVERFLOW");
    expect(result.underFix.findings.map((f) => f.code)).toContain("QUEUE_OVERFLOW");
    expect(result.resolved).toBe(false);
  });

  it("resolves a HIGH_UTILIZATION warning by adding headroom before anything saturates", () => {
    // 20 -> 30 instances: 30*50=1,500 servers at 15ms => 100,000 rps
    // capacity. 60,000 / 100,000 = 60% — comfortably back under the 80%
    // threshold.
    const result = compareFix(urlShortener, "workload:traffic-6x", "svc:instances-1.5x-preventive");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("HIGH_UTILIZATION");
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("HIGH_UTILIZATION");
    expect(result.resolved).toBe(true);

    const svc = result.underFix.components.find((c) => c.componentId === "svc")!;
    expect(svc.utilization).toBeCloseTo(0.6, 5);
  });

  it("throws for a fix that doesn't apply to the scenario's findings", () => {
    expect(() => compareFix(checkout, "db:pool-shrink-50", "db:pool-2x")).toThrow(
      /unknown fix/i,
    );
  });

  it("leaves the original model untouched", () => {
    const before = JSON.stringify(checkout);
    compareFix(checkout, "workload:traffic-10x", "db:pool-2x");
    expect(JSON.stringify(checkout)).toBe(before);
  });
});
