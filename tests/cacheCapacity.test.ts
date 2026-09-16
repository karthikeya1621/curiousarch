/**
 * Regression tests for a real bug found while inventing a held-out system
 * for PLAN-0.4: a cache's capacity was computed from `hitLatencyMs` (the
 * client-observed round trip, dominated by network transit for a remote
 * cache) instead of the server's actual per-op busy time. A 1ms cache
 * modelled this way has a hard capacity ceiling of 1,000 rps — orders of
 * magnitude below real single-instance Redis throughput — and worse,
 * `deriveFindings` had no case for a saturated cache at all, so a cache
 * pinned at Infinity latency reported the whole system as healthy.
 *
 * Confirmed live in the checked-in, golden-tested `urlShortener` reference
 * model itself: at its own golden-tested 10,000 rps, the cache was already
 * saturated (1000% utilization, Infinity latency) while `healthy` read true.
 *
 * Every expected value below is derived on paper, matching this repo's own
 * rule for golden tests — not captured from a run.
 */

import { describe, expect, it } from "vitest";
import { simulate, findBreakingPoint } from "../src/solver.js";
import { urlShortener } from "../models/reference.js";
import type { SystemModel } from "../src/types.js";

describe("cache capacity", () => {
  it("sizes capacity on cpuTimeMs, not hitLatencyMs", () => {
    // cpuTimeMs = 0.01ms => 1 / 0.00001s = 100,000 rps for a single shard.
    const result = simulate(urlShortener);
    const cache = result.components.find((c) => c.componentId === "cache")!;
    expect(Math.round(cache.capacityRps)).toBe(100_000);
  });

  it("reports hitLatencyMs as the latency floor, not cpuTimeMs", () => {
    // At 10,000 rps arrival against 100,000 rps capacity (10% utilization),
    // queueing wait is negligible; mean latency should sit just above the
    // stated 1ms round trip, not near cpuTimeMs (0.01ms).
    const result = simulate(urlShortener);
    const cache = result.components.find((c) => c.componentId === "cache")!;
    expect(cache.meanLatencyMs).toBeGreaterThan(1);
    expect(cache.meanLatencyMs).toBeLessThan(1.1);
  });

  it("does not silently mask a saturated cache as healthy (the actual bug)", () => {
    // 150,000 rps exceeds the cache's own 100,000 rps capacity — this must
    // surface as CACHE_SATURATED with healthy: false, not disappear.
    const overloaded = simulate({
      ...urlShortener,
      workload: { ...urlShortener.workload, rps: 150_000 },
    });
    expect(overloaded.healthy).toBe(false);
    expect(overloaded.findings.map((f) => f.code)).toContain("CACHE_SATURATED");

    const cache = overloaded.components.find((c) => c.componentId === "cache")!;
    expect(cache.saturated).toBe(true);
    expect(cache.meanLatencyMs).toBe(Infinity);
  });

  it("reports what the cache would need to keep up", () => {
    const overloaded = simulate({
      ...urlShortener,
      workload: { ...urlShortener.workload, rps: 150_000 },
    });
    const finding = overloaded.findings.find((f) => f.code === "CACHE_SATURATED")!;
    // 1 server / 150,000 rps => needs <= ~0.0067ms per op to keep up.
    expect(finding.evidence.requiredCpuTimeMs).toBeCloseTo(1000 / 150_000, 4);
    expect(finding.evidence.maxSustainableRps).toBe(100_000);
  });

  it("keeps the hand-modelled url-shortener bottleneck at the service, not the cache", () => {
    // Regression guard: the fix must not make the cache the reported
    // bottleneck for the existing reference system — the service's 66,667
    // rps limit (documented in models/reference.ts) is still well below the
    // cache's realistic 100,000 rps capacity.
    const breaking = findBreakingPoint(urlShortener)!;
    expect(breaking.rps).toBeGreaterThan(50_000);
    expect(breaking.rps).toBeLessThan(70_000);
    expect(breaking.findings.map((f) => f.code)).toContain("SERVICE_SATURATED");
    expect(breaking.findings.map((f) => f.code)).not.toContain("CACHE_SATURATED");
  });

  it("still flags a genuinely undersized cache before anything downstream", () => {
    // A cache too slow to keep pace with even modest traffic must be named
    // as the bottleneck, not masked by a downstream finding at a much
    // higher load.
    const undersized: SystemModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.kind === "cache" ? { ...c, cpuTimeMs: { ...c.cpuTimeMs, value: 5 } } : c,
      ),
    };
    // cpuTimeMs=5ms => capacity = 1/0.005 = 200 rps.
    const result = simulate({ ...undersized, workload: { rps: 500 } });
    expect(result.healthy).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("CACHE_SATURATED");
    expect(result.findings.map((f) => f.code)).not.toContain("SERVICE_SATURATED");
  });
});
