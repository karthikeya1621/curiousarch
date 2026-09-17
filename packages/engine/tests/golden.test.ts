/**
 * Golden tests.
 *
 * These encode what an engineer reviewing these three systems would expect
 * to see: which real architectural risk each one has going in, and why.
 * If the engine can't reproduce these, nothing built on top of it is
 * trustworthy. Same role these tests played before the architect-pivot —
 * assertions are now about which pattern fires and why, not which number
 * crosses which threshold, because there are no numbers to cross anymore.
 */

import { describe, expect, it } from "vitest";
import { simulate, findBreakingTier } from "../src/solver.js";
import { checkout, mediaUpload, urlShortener } from "../models/reference.js";
import type { FindingCode, SystemModel } from "../src/types.js";

function codes(model: SystemModel): FindingCode[] {
  return simulate(model).findings.map((f) => f.code);
}

describe("Checkout / order placement", () => {
  it("is provisioned against instance and replica loss", () => {
    const svc = checkout.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("multiple");

    const db = checkout.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.instanceCount.value).toBe("has-replicas");
  });

  it("flags the missing circuit breaker as a cascading-failure risk", () => {
    // gw -> svc -> db is a 3-deep synchronous chain (no queue/cache breaks
    // it), and nothing in it has a circuit breaker.
    const result = simulate(checkout);
    expect(result.healthy).toBe(false);
    const finding = result.findings.find((f) => f.code === "CASCADING_FAILURE_RISK");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.componentId).toBe("db"); // the chain's tail
  });

  it("would also flag a single point of failure if it lost its replica", () => {
    const noReplica: SystemModel = {
      ...checkout,
      components: checkout.components.map((c) =>
        c.id === "db" && c.kind === "database"
          ? { ...c, instanceCount: { ...c.instanceCount, value: "single" as const } }
          : c,
      ),
    };
    expect(codes(noReplica)).toContain("SINGLE_POINT_OF_FAILURE");
  });

  it("breaks at every scale — this is a structural risk, not a capacity one", () => {
    // CASCADING_FAILURE_RISK doesn't depend on workload.scale at all, so
    // stepping the tier up never changes the verdict — correctly: adding
    // load doesn't cause a missing circuit breaker, it was always missing.
    expect(findBreakingTier(checkout)?.scale).toBe("small");
  });
});

describe("URL shortener", () => {
  it("routes reads through a cache with a small, short-lived hot set", () => {
    const cache = urlShortener.components.find((c) => c.id === "cache");
    if (cache?.kind !== "cache") throw new Error("expected cache");
    expect(cache.ttl.value).toBe("short");
    expect(cache.keyspaceSize.value).toBe("small");
    expect(cache.hasStampedeProtection.value).toBe(false);
  });

  it("flags the thundering-herd risk this combination creates", () => {
    const result = simulate(urlShortener);
    expect(result.healthy).toBe(false);
    const finding = result.findings.find((f) => f.code === "THUNDERING_HERD_RISK");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.componentId).toBe("cache");
  });

  it("does not also flag a cascading-failure risk — the circuit breaker covers it", () => {
    // gw -> svc -> cache -> db is 4 deep, which would otherwise qualify,
    // but the redirect service has a circuit breaker.
    expect(codes(urlShortener)).not.toContain("CASCADING_FAILURE_RISK");
  });

  it("does not cry herd once stampede protection is added", () => {
    const protectedModel: SystemModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.id === "cache" && c.kind === "cache"
          ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: true } }
          : c,
      ),
    };
    expect(codes(protectedModel)).not.toContain("THUNDERING_HERD_RISK");
  });

  it("does not cry herd over a large, long-lived keyspace", () => {
    // Same missing stampede protection, but a large keyspace and a long
    // TTL — the specific coincidence this pattern names isn't present.
    const roomier: SystemModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.id === "cache" && c.kind === "cache"
          ? { ...c, keyspaceSize: { ...c.keyspaceSize, value: "large" as const }, ttl: { ...c.ttl, value: "long" as const } }
          : c,
      ),
    };
    expect(codes(roomier)).not.toContain("THUNDERING_HERD_RISK");
  });
});

describe("Media upload with async processing", () => {
  it("is healthy — every finding here is a warning, not a critical", () => {
    const result = simulate(mediaUpload);
    expect(result.healthy).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("warns about no rate limiting, no dead-letter queue, and fixed scaling at its own scale", () => {
    const found = codes(mediaUpload);
    expect(found).toContain("UNBOUNDED_ADMISSION");
    expect(found).toContain("QUEUE_NO_DEAD_LETTER");
    expect(found).toContain("FIXED_SCALING_AT_SCALE");
  });

  it("does not warn about fixed scaling below large scale", () => {
    // Same fixed consumer pool, but at small/medium scale a burst is less
    // likely to outrun it — the pattern is specifically about scale.
    const smaller: SystemModel = {
      ...mediaUpload,
      workload: { scale: { ...mediaUpload.workload.scale, value: "small" } },
    };
    expect(codes(smaller)).not.toContain("FIXED_SCALING_AT_SCALE");
  });

  it("stops the synchronous chain at the queue — api->queue is only 2 deep", () => {
    // gw -> api -> queue is 2 components before the async boundary; nothing
    // downstream of the queue (db) is on anyone's synchronous path, so
    // CASCADING_FAILURE_RISK never has a long enough chain to fire here
    // regardless of circuit breakers.
    expect(codes(mediaUpload)).not.toContain("CASCADING_FAILURE_RISK");
  });

  it("never reaches an unhealthy tier — nothing here is a critical pattern", () => {
    expect(findBreakingTier(mediaUpload)).toBeNull();
  });
});

describe("UNCACHED_DATABASE_AT_SCALE", () => {
  // None of the three reference models trigger this at baseline —
  // checkout's db is write-heavy, url-shortener's already has a cache in
  // the chain, media-upload's db is fed through a queue — so the positive
  // path needs its own fixture, same as the cache/queue scenarios in
  // whatif.test.ts do.
  const readHeavyAtScale: SystemModel = {
    ...checkout,
    workload: { scale: { ...checkout.workload.scale, value: "large" } },
    components: checkout.components.map((c) =>
      c.id === "db" && c.kind === "database"
        ? { ...c, writeVolume: { ...c.writeVolume, value: "low" } }
        : c,
    ),
  };

  it("flags a read-heavy database on a direct synchronous path at scale", () => {
    const finding = simulate(readHeavyAtScale).findings.find(
      (f) => f.code === "UNCACHED_DATABASE_AT_SCALE",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");
    expect(finding!.componentId).toBe("db");
  });

  it("does not fire below large scale", () => {
    const small: SystemModel = {
      ...readHeavyAtScale,
      workload: { scale: { ...readHeavyAtScale.workload.scale, value: "small" } },
    };
    expect(codes(small)).not.toContain("UNCACHED_DATABASE_AT_SCALE");
  });

  it("does not fire on a write-heavy database — checkout as-is, at any scale", () => {
    const atScale: SystemModel = {
      ...checkout,
      workload: { scale: { ...checkout.workload.scale, value: "massive" } },
    };
    expect(codes(atScale)).not.toContain("UNCACHED_DATABASE_AT_SCALE");
  });

  it("does not fire once a cache already sits in the chain — url-shortener", () => {
    expect(codes(urlShortener)).not.toContain("UNCACHED_DATABASE_AT_SCALE");
  });

  it("does not fire on a database fed through a queue — media-upload", () => {
    // api -> queue -> db: the queue is an async boundary, so db is never
    // the tail of a synchronous chain in the first place.
    expect(codes(mediaUpload)).not.toContain("UNCACHED_DATABASE_AT_SCALE");
  });
});

describe("simulate", () => {
  it("rejects a model with a cycle", () => {
    const cyclic: SystemModel = {
      ...checkout,
      edges: [...checkout.edges, { from: "db", to: "svc" }],
    };
    expect(() => simulate(cyclic)).toThrow(/cycle/i);
  });
});
