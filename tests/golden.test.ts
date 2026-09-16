/**
 * Golden tests.
 *
 * These encode what an engineer who has operated these systems expects to see.
 * They are the Phase 0 kill criterion: if the engine cannot reproduce these,
 * nothing built on top of it is trustworthy.
 */

import { describe, expect, it } from "vitest";
import { findBreakingPoint, simulate } from "../src/solver.js";
import { checkout, mediaUpload, urlShortener } from "../models/reference.js";
import type { FindingCode, SystemModel } from "../src/types.js";

function at(model: SystemModel, rps: number) {
  return simulate({ ...model, workload: { ...model.workload, rps } });
}

function codes(model: SystemModel, rps: number): FindingCode[] {
  return at(model, rps).findings.map((f) => f.code);
}

describe("URL shortener", () => {
  it("routes only cache misses to the database", () => {
    const result = at(urlShortener, 10_000);
    const db = result.components.find((c) => c.componentId === "db")!;
    // 95% hit rate => 500 qps reaches Postgres.
    expect(db.arrivalRps).toBeCloseTo(500, 6);
  });

  it("is healthy at its stated load", () => {
    expect(at(urlShortener, 10_000).healthy).toBe(true);
  });

  it("puts the service, not the database, on the critical path", () => {
    // Service: 20*50 = 1000 servers at 15ms => 66,667 RPS.
    // DB: 100 conns at 8ms => 12,500 qps, reached only at 250,000 RPS.
    const svc = at(urlShortener, 10_000).components.find(
      (c) => c.componentId === "svc",
    )!;
    expect(Math.round(svc.capacityRps)).toBe(66_667);

    const breaking = findBreakingPoint(urlShortener)!;
    expect(breaking.findings.map((f) => f.code)).toContain("SERVICE_SATURATED");
    expect(breaking.rps).toBeGreaterThan(50_000);
    expect(breaking.rps).toBeLessThan(70_000);
  });

  it("warns before it breaks, not after", () => {
    // 80% of 66,667 is ~53,300 — high utilization should fire while still
    // stable, which is the whole point of an early indicator.
    const warned = at(urlShortener, 55_000);
    expect(warned.healthy).toBe(true);
    expect(warned.findings.map((f) => f.code)).toContain("HIGH_UTILIZATION");
  });

  it("does not cry herd over a fast primary-key lookup", () => {
    // 10,000 hot keys at 10k RPS is 1 request per key per second; an 8ms
    // refill cannot accumulate duplicates. Shortening the TTL alone must not
    // manufacture a warning — an operator would not believe it.
    const shortTtl: SystemModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.kind === "cache"
          ? { ...c, ttlSeconds: { ...c.ttlSeconds, value: 1 } }
          : c,
      ),
    };
    expect(codes(urlShortener, 10_000)).not.toContain("THUNDERING_HERD");
    expect(codes(shortTtl, 10_000)).not.toContain("THUNDERING_HERD");
  });

  it("flags a herd when few hot keys sit over a slow refill", () => {
    // 100 hot keys at 10k RPS is 100 req/key/sec; a 150ms aggregation leaves
    // ~15 identical queries in flight every time one expires.
    const expensive: SystemModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) => {
        if (c.kind === "cache") {
          return { ...c, keyspaceHotSet: { ...c.keyspaceHotSet, value: 100 } };
        }
        if (c.kind === "database") {
          return { ...c, queryTimeMs: { ...c.queryTimeMs, value: 150 } };
        }
        return c;
      }),
    };
    const finding = at(expensive, 10_000).findings.find(
      (f) => f.code === "THUNDERING_HERD",
    );
    expect(finding).toBeDefined();
    expect(finding!.evidence.duplicateQueriesPerExpiry).toBeCloseTo(15, 1);
  });
});

describe("Checkout", () => {
  it("exhausts the connection pool at the hand-computed load", () => {
    // 40 connections / 25ms = 1,600 RPS sustainable.
    const healthy = at(checkout, 1_500);
    expect(healthy.findings.map((f) => f.code)).not.toContain(
      "CONNECTION_POOL_EXHAUSTED",
    );

    const broken = at(checkout, 1_700);
    expect(broken.findings.map((f) => f.code)).toContain(
      "CONNECTION_POOL_EXHAUSTED",
    );
    expect(broken.healthy).toBe(false);
  });

  it("reports the connections actually required as evidence", () => {
    const finding = at(checkout, 2_000).findings.find(
      (f) => f.code === "CONNECTION_POOL_EXHAUSTED",
    )!;
    // 2,000 rps * 25ms = 50 concurrent connections needed against a pool of 40.
    expect(finding.evidence.connectionsRequired).toBe(50);
    expect(finding.evidence.poolSize).toBe(40);
    expect(finding.evidence.maxSustainableRps).toBe(1_600);
  });

  it("detects replication lag before the pool gives out", () => {
    // Writes are 90% of traffic; replicas apply 800/s, so lag begins near
    // 889 RPS — well under the 1,600 RPS pool limit.
    const lagging = at(checkout, 1_000);
    expect(lagging.findings.map((f) => f.code)).toContain("REPLICATION_LAG");
    expect(lagging.findings.map((f) => f.code)).not.toContain(
      "CONNECTION_POOL_EXHAUSTED",
    );
  });

  it("quantifies how fast replicas fall behind", () => {
    const finding = at(checkout, 1_600).findings.find(
      (f) => f.code === "REPLICATION_LAG",
    )!;
    // 1,440 writes/s against 800/s applied => 0.8s of lag per second elapsed.
    expect(finding.evidence.writeRps).toBe(1_440);
    expect(finding.evidence.lagGrowthSecondsPerSecond).toBeCloseTo(0.8, 3);
  });

  it("shows latency degrading non-linearly as the pool fills", () => {
    const p50 = at(checkout, 800).components.find(
      (c) => c.componentId === "db",
    )!;
    const p90 = at(checkout, 1_440).components.find(
      (c) => c.componentId === "db",
    )!;
    expect(p50.utilization).toBeCloseTo(0.5, 6);
    expect(p90.utilization).toBeCloseTo(0.9, 6);
    // The tail must degrade faster than the mean. At 50% the pool almost never
    // makes a request wait, so p99 is just service time; at 90% queueing
    // dominates the tail while barely moving the average. Reporting only a
    // mean would hide this, which is why the UI shows p99.
    const meanGrowth = p90.meanLatencyMs / p50.meanLatencyMs;
    const tailGrowth = p90.p99LatencyMs / p50.p99LatencyMs;
    expect(tailGrowth).toBeGreaterThan(meanGrowth * 1.5);
    expect(p90.p99LatencyMs).toBeGreaterThan(p90.meanLatencyMs * 1.6);
  });
});

describe("Media upload", () => {
  it("excludes async workers from synchronous latency", () => {
    const result = at(mediaUpload, 5);
    // A 2-second transcode must not appear in the caller's latency.
    expect(result.endToEndMeanMs).toBeLessThan(100);
  });

  it("finds the queue overflow point at consumer capacity", () => {
    // 12 consumers / 2s = 6 jobs per second.
    const queue = at(mediaUpload, 5).components.find(
      (c) => c.componentId === "queue",
    )!;
    expect(queue.capacityRps).toBeCloseTo(6, 6);

    expect(codes(mediaUpload, 5)).not.toContain("QUEUE_OVERFLOW");
    expect(codes(mediaUpload, 50)).toContain("QUEUE_OVERFLOW");
  });

  it("says how long until the queue is full", () => {
    const finding = at(mediaUpload, 50).findings.find(
      (f) => f.code === "QUEUE_OVERFLOW",
    )!;
    // (50 - 6) deficit against 100,000 capacity => ~2,272s.
    expect(finding.evidence.secondsUntilFull).toBeCloseTo(2_272.7, 0);
  });

  it("throttles downstream load to what consumers can drain", () => {
    // The DB sees drained throughput, not offered load — this is what the
    // queue is for, and getting it wrong would overstate DB pressure.
    const db = at(mediaUpload, 500).components.find(
      (c) => c.componentId === "db",
    )!;
    expect(db.arrivalRps).toBeCloseTo(6, 6);
  });
});

describe("finding credibility", () => {
  it("never emits a finding whose own evidence says nothing is wrong", () => {
    // Regression: replication lag used to fire at the exact break-even point
    // and report 0 seconds of lag per second, which destroys trust faster than
    // missing the finding would.
    for (const rps of [500, 889, 890, 1_000, 1_600, 5_000]) {
      for (const finding of at(checkout, rps).findings) {
        for (const [key, value] of Object.entries(finding.evidence)) {
          if (typeof value === "number" && /lag|deficit|required/i.test(key)) {
            expect(value, `${finding.code}.${key} at ${rps} rps`).not.toBe(0);
          }
        }
      }
    }
  });

  it("grades queue overflow by time to impact, not by the fact of it", () => {
    // 7 rps against a 6 rps drain takes ~28 hours to fill 100k messages.
    const slow = at(mediaUpload, 7).findings.find(
      (f) => f.code === "QUEUE_OVERFLOW",
    )!;
    expect(slow.severity).toBe("warning");
    expect(at(mediaUpload, 7).healthy).toBe(true);

    // 100 rps fills the same queue in under 20 minutes.
    const fast = at(mediaUpload, 100).findings.find(
      (f) => f.code === "QUEUE_OVERFLOW",
    )!;
    expect(fast.severity).toBe("critical");
    expect(Number(fast.evidence.secondsUntilFull)).toBeLessThan(3_600);
  });

  it("separates replica drift from replicas losing the race", () => {
    // 5% over apply rate: recoverable drift.
    const drift = at(checkout, 930).findings.find(
      (f) => f.code === "REPLICATION_LAG",
    )!;
    expect(drift.severity).toBe("warning");

    // 80% over: a minute of runtime buys ~48s of staleness.
    const losing = at(checkout, 1_600).findings.find(
      (f) => f.code === "REPLICATION_LAG",
    )!;
    expect(losing.severity).toBe("critical");
    expect(losing.evidence.lagAfter5MinSeconds).toBeCloseTo(240, 0);
  });

  it("tells the user what to change, not just what broke", () => {
    const pool = at(checkout, 2_000).findings.find(
      (f) => f.code === "CONNECTION_POOL_EXHAUSTED",
    )!;
    expect(pool.evidence.connectionsRequired).toBe(50);

    const queue = at(mediaUpload, 100).findings.find(
      (f) => f.code === "QUEUE_OVERFLOW",
    )!;
    // 100 rps at 2s each needs 200 consumers against the current 12.
    expect(queue.evidence.consumersRequired).toBe(200);
  });
});

describe("engine invariants", () => {
  it("never reports a finite latency for a saturated component", () => {
    for (const result of at(checkout, 100_000).components) {
      if (result.saturated && result.componentId !== "gw") {
        expect(result.meanLatencyMs).toBe(Infinity);
      }
    }
  });

  it("rejects cyclic models rather than looping forever", () => {
    const cyclic: SystemModel = {
      ...checkout,
      edges: [...checkout.edges, { from: "db", to: "svc", callsPerRequest: 1 }],
    };
    expect(() => simulate(cyclic)).toThrow(/cycle/i);
  });

  it("keeps every parameter's provenance available for the UI", () => {
    // The correction loop depends on this: users must see what was guessed.
    const db = checkout.components.find((c) => c.id === "db")!;
    if (db.kind !== "database") throw new Error("unexpected kind");
    expect(db.queryTimeMs.provenance).toBe("inferred");
    expect(db.connectionPoolSize.provenance).toBe("stated");
    expect(db.queryTimeMs.rationale).toBeTruthy();
  });
});
