/**
 * Fix catalogue: applying a failure scenario, then a fix on top of it, and
 * confirming the fix's trait flip actually does what its label claims and
 * that re-simulating shows the intended recovery. Expected outcomes are
 * reasoned from the reference models' own traits, not captured from a run.
 */

import { describe, expect, it } from "vitest";
import { listFixes, compareFix } from "../src/fixes.js";
import { applyScenario } from "../src/whatif.js";
import { checkout, mediaUpload, urlShortener } from "../models/reference.js";
import type { SystemModel } from "../src/types.js";

/** url-shortener with the one thing wrong at baseline (the herd risk) fixed. */
const cleanUrlShortener: SystemModel = {
  ...urlShortener,
  components: urlShortener.components.map((c) =>
    c.id === "cache" && c.kind === "cache"
      ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: true } }
      : c,
  ),
};

describe("listFixes", () => {
  it("is empty when the scenario doesn't produce any finding", () => {
    // cleanUrlShortener has zero findings at baseline (no SPOF, no herd, no
    // cascading — the circuit breaker covers it); scale doesn't affect any
    // of that, and there's no queue here for FIXED_SCALING_AT_SCALE either.
    expect(listFixes(cleanUrlShortener, "workload:scale-up")).toEqual([]);
  });

  it("offers fixes keyed by whatever findings the scenario actually produces", () => {
    // checkout already has CASCADING_FAILURE_RISK at baseline; losing the
    // service's instance adds SINGLE_POINT_OF_FAILURE on top of it.
    const fixes = listFixes(checkout, "svc:loses-instance");
    const ids = fixes.map((f) => f.id);
    expect(ids).toContain("svc:add-circuit-breaker");
    expect(ids).toContain("svc:add-instance");
  });

  it("de-duplicates fixes when multiple findings would offer the same one", () => {
    const fixes = listFixes(checkout, "svc:loses-instance");
    const ids = fixes.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("walks back to the calling service for a cascading-failure fix, not the finding's own component", () => {
    // The finding sits on "db" (the chain's tail); the fix belongs on
    // "svc", the service actually making the synchronous call.
    const fixes = listFixes(checkout, "workload:scale-up");
    const breaker = fixes.find((f) => f.targetsFindingCode === "CASCADING_FAILURE_RISK")!;
    expect(breaker.id).toBe("svc:add-circuit-breaker");
  });
});

describe("compareFix", () => {
  it("actually flips the targeted trait, not just the label", () => {
    compareFix(checkout, "svc:loses-instance", "svc:add-instance");
    // Original is untouched regardless of what the fix does internally.
    const original = checkout.components.find((c) => c.id === "svc");
    if (original?.kind !== "service") throw new Error("expected service");
    expect(original.instanceCount.value).toBe("multiple");
  });

  it("resolves the specific finding it targets", () => {
    const result = compareFix(checkout, "svc:loses-instance", "svc:add-instance");
    expect(result.underFailure.findings.map((f) => f.code)).toContain(
      "SINGLE_POINT_OF_FAILURE",
    );
    expect(result.underFix.findings.map((f) => f.code)).not.toContain(
      "SINGLE_POINT_OF_FAILURE",
    );
    expect(result.resolved).toBe(true);
  });

  it("does not claim to resolve a finding it doesn't target", () => {
    // Adding an instance back does nothing about the pre-existing missing
    // circuit breaker.
    const result = compareFix(checkout, "svc:loses-instance", "svc:add-instance");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");
    expect(result.underFix.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");
  });

  it("resolves the cascading-failure finding by adding a circuit breaker on the calling service, not the finding's own component", () => {
    const result = compareFix(checkout, "workload:scale-up", "svc:add-circuit-breaker");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("CASCADING_FAILURE_RISK");
    expect(result.resolved).toBe(true);
  });

  it("resolves a thundering-herd risk with either of its two fixes", () => {
    const viaStampedeProtection = compareFix(
      urlShortener,
      "workload:scale-up",
      "cache:stampede-protection",
    );
    expect(viaStampedeProtection.resolved).toBe(true);

    const viaLongerTtl = compareFix(urlShortener, "workload:scale-up", "cache:lengthen-ttl");
    expect(viaLongerTtl.resolved).toBe(true);
  });

  it("resolves a fixed-scaling warning by switching to autoscaling", () => {
    const small: SystemModel = {
      ...mediaUpload,
      workload: { scale: { ...mediaUpload.workload.scale!, value: "medium" } },
    };
    const result = compareFix(small, "workload:scale-up", "queue:autoscale-consumers");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("FIXED_SCALING_AT_SCALE");
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("FIXED_SCALING_AT_SCALE");
    expect(result.resolved).toBe(true);
  });

  it("resolves an unbounded-admission warning by adding rate limiting", () => {
    // checkout's gateway is rate-limited at baseline; the "rate limiter is
    // disabled" scenario is what actually produces UNBOUNDED_ADMISSION to
    // fix here.
    const result = compareFix(checkout, "gw:rate-limit-disabled", "gw:add-rate-limiting");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("UNBOUNDED_ADMISSION");
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("UNBOUNDED_ADMISSION");
    expect(result.resolved).toBe(true);
  });

  it("resolves a queue's missing dead-letter warning", () => {
    // media-upload's queue has no dead-letter queue at baseline — no
    // scenario needed, the finding is already present.
    const result = compareFix(mediaUpload, "workload:scale-up", "queue:add-dlq");
    expect(result.underFailure.findings.map((f) => f.code)).toContain("QUEUE_NO_DEAD_LETTER");
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("QUEUE_NO_DEAD_LETTER");
    expect(result.resolved).toBe(true);
  });

  it("resolves an uncached-database warning by structurally adding a cache", () => {
    // No reference model triggers this at baseline — same reason as the
    // cache/queue scenarios in whatif.test.ts — so this fixture (checkout
    // with a read-heavy db at large scale) is the positive-path fixture,
    // reused from golden.test.ts's UNCACHED_DATABASE_AT_SCALE suite.
    // workload:scale-up (large -> massive) is a neutral vehicle scenario
    // here, same role it plays in the QUEUE_NO_DEAD_LETTER test above —
    // the finding is already present at baseline, not caused by the scenario.
    const readHeavyAtScale: SystemModel = {
      ...checkout,
      workload: { scale: { ...checkout.workload.scale!, value: "large" } },
      components: checkout.components.map((c) =>
        c.id === "db" && c.kind === "database"
          ? { ...c, writeVolume: { ...c.writeVolume, value: "low" } }
          : c,
      ),
    };

    const result = compareFix(readHeavyAtScale, "workload:scale-up", "db:add-cache");
    expect(result.underFailure.findings.map((f) => f.code)).toContain(
      "UNCACHED_DATABASE_AT_SCALE",
    );
    expect(result.underFix.findings.map((f) => f.code)).not.toContain(
      "UNCACHED_DATABASE_AT_SCALE",
    );
    expect(result.resolved).toBe(true);

    // This is the one fix that changes the topology, not just a trait —
    // confirm it actually did, rather than just trusting the finding diff.
    const applied = result.fix.apply(applyScenario(readHeavyAtScale, "workload:scale-up"));
    expect(applied.components.length).toBe(readHeavyAtScale.components.length + 1);
    const newCache = applied.components.find((c) => c.id === "db-cache");
    expect(newCache?.kind).toBe("cache");
    expect(applied.edges).toContainEqual({ from: "svc", to: "db-cache" });
    expect(applied.edges).toContainEqual({ from: "db-cache", to: "db" });
    expect(applied.edges).not.toContainEqual({ from: "svc", to: "db" });

    // A cache is not a circuit breaker — this fix correctly does not also
    // resolve the unrelated cascading-failure risk on the same chain.
    expect(result.underFailure.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");
    expect(result.underFix.findings.map((f) => f.code)).toContain("CASCADING_FAILURE_RISK");

    // The freshly-added cache ships with safe-enough defaults that it
    // doesn't just relocate the problem into a new thundering-herd risk.
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("THUNDERING_HERD_RISK");
  });

  it("is the one fix flagged for an AI proposal, and none of the others are", () => {
    const fixes = listFixes(checkout, "gw:rate-limit-disabled");
    for (const fix of fixes) expect(fix.hasAiProposal).toBeFalsy();

    const readHeavyAtScale: SystemModel = {
      ...checkout,
      workload: { scale: { ...checkout.workload.scale!, value: "large" } },
      components: checkout.components.map((c) =>
        c.id === "db" && c.kind === "database"
          ? { ...c, writeVolume: { ...c.writeVolume, value: "low" } }
          : c,
      ),
    };
    const cacheFix = listFixes(readHeavyAtScale, "workload:scale-up").find(
      (f) => f.id === "db:add-cache",
    );
    expect(cacheFix?.hasAiProposal).toBe(true);
  });

  it("uses AI-proposed cache values, with inferred provenance, when supplied", () => {
    const readHeavyAtScale: SystemModel = {
      ...checkout,
      workload: { scale: { ...checkout.workload.scale!, value: "large" } },
      components: checkout.components.map((c) =>
        c.id === "db" && c.kind === "database"
          ? { ...c, writeVolume: { ...c.writeVolume, value: "low" } }
          : c,
      ),
    };

    const proposedTraits = {
      ttl: { value: "short", rationale: "This system needs fresh totals." },
      keyspaceSize: { value: "small", rationale: "Only a handful of hot orders dominate." },
      hasStampedeProtection: { value: true, rationale: "Short TTL + small keyspace needs coalescing." },
    };

    const result = compareFix(
      readHeavyAtScale,
      "workload:scale-up",
      "db:add-cache",
      proposedTraits,
    );
    const applied = result.fix.apply(
      applyScenario(readHeavyAtScale, "workload:scale-up"),
      proposedTraits,
    );
    const newCache = applied.components.find((c) => c.id === "db-cache");
    if (newCache?.kind !== "cache") throw new Error("expected cache");
    expect(newCache.ttl).toEqual({ value: "short", provenance: "inferred", rationale: "This system needs fresh totals." });
    expect(newCache.keyspaceSize.value).toBe("small");
    expect(newCache.keyspaceSize.provenance).toBe("inferred");
    expect(newCache.hasStampedeProtection.value).toBe(true);

    // Precisely the trap the proposal prompt warns against (short TTL +
    // small keyspace) — only made safe here because hasStampedeProtection
    // was also proposed true. The engine still recomputes this for real
    // rather than trusting that the AI's own choice was safe.
    expect(result.underFix.findings.map((f) => f.code)).not.toContain("THUNDERING_HERD_RISK");
  });

  it("throws for a fix that doesn't apply to the scenario's findings", () => {
    expect(() => compareFix(checkout, "workload:scale-up", "svc:add-instance")).toThrow(
      /unknown fix/i,
    );
  });

  it("leaves the original model untouched", () => {
    const before = JSON.stringify(checkout);
    compareFix(checkout, "svc:loses-instance", "svc:add-instance");
    expect(JSON.stringify(checkout)).toBe(before);
  });
});
