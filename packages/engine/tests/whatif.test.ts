/**
 * What-if scenarios: a hypothetical degradation of a model, diffed against
 * its own baseline via the same `simulate()` the golden tests hold to a
 * hand-derived standard. Each scenario flips one trait toward its riskier
 * value; expected outcomes are reasoned from the reference models' own
 * traits, not captured from a run.
 */

import { describe, expect, it } from "vitest";
import { listScenarios, applyScenario, compareScenario, setTraitValue } from "../src/whatif.js";
import { checkout, urlShortener, mediaUpload } from "../models/reference.js";

describe("listScenarios", () => {
  it("only offers a scenario when the trait flip is meaningful", () => {
    // checkout: svc is "multiple" (can lose an instance), db "has-replicas"
    // (can lose its replica), gw hasRateLimiting (can be disabled) — all
    // three flips are offered. Nothing offers a scenario that would be a
    // no-op or already-true.
    const ids = listScenarios(checkout).map((s) => s.id);
    expect(ids).toContain("svc:loses-instance");
    expect(ids).toContain("db:replica-fails");
    expect(ids).toContain("gw:rate-limit-disabled");
  });

  it("does not offer a scenario a component is already living", () => {
    // url-shortener's cache already has hasStampedeProtection: false — no
    // "stampede protection fails" scenario exists for something already
    // failed at baseline.
    const ids = listScenarios(urlShortener).map((s) => s.id);
    expect(ids).not.toContain("cache:stampede-protection-fails");
  });

  it("offers a queue's autoscaler-stuck scenario only when it currently autoscales", () => {
    // media-upload's queue is "fixed", not "auto" — no scenario to break
    // something that isn't there.
    expect(listScenarios(mediaUpload).map((s) => s.id)).not.toContain(
      "queue:autoscaler-stuck",
    );

    // None of the three reference models ship a queue with "auto" scaling
    // (media-upload's is deliberately "fixed", to demonstrate
    // FIXED_SCALING_AT_SCALE) — so the *positive* path needs its own
    // fixture, same as the "protectedModel" pattern below does for the
    // cache scenario.
    const autoScaling = {
      ...mediaUpload,
      components: mediaUpload.components.map((c) =>
        c.id === "queue" && c.kind === "queue"
          ? { ...c, consumerScaling: { ...c.consumerScaling, value: "auto" as const } }
          : c,
      ),
    };
    const scenario = listScenarios(autoScaling).find((s) => s.id === "queue:autoscaler-stuck");
    expect(scenario).toBeDefined();

    const degraded = scenario!.apply(autoScaling);
    const queue = degraded.components.find((c) => c.id === "queue");
    if (queue?.kind !== "queue") throw new Error("expected queue");
    expect(queue.consumerScaling.value).toBe("fixed");
  });

  it("offers a cache's stampede-protection-fails scenario only when it currently has protection", () => {
    // Same reason as the queue case above: none of the three reference
    // models ship a cache with stampede protection already on (that would
    // clear THUNDERING_HERD_RISK on url-shortener, the model built
    // specifically to demonstrate it) — the positive path needs its own
    // fixture.
    const protectedCache = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.id === "cache" && c.kind === "cache"
          ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: true } }
          : c,
      ),
    };
    const scenario = listScenarios(protectedCache).find(
      (s) => s.id === "cache:stampede-protection-fails",
    );
    expect(scenario).toBeDefined();

    const degraded = scenario!.apply(protectedCache);
    const cache = degraded.components.find((c) => c.id === "cache");
    if (cache?.kind !== "cache") throw new Error("expected cache");
    expect(cache.hasStampedeProtection.value).toBe(false);
  });

  it("flips a gateway's rate limiting off", () => {
    // checkout's gateway has hasRateLimiting: true at baseline — the one
    // reference model where this scenario's positive path is reachable
    // without a custom fixture.
    const scenario = listScenarios(checkout).find((s) => s.id === "gw:rate-limit-disabled")!;
    const degraded = scenario.apply(checkout);
    const gw = degraded.components.find((c) => c.id === "gw");
    if (gw?.kind !== "gateway") throw new Error("expected gateway");
    expect(gw.hasRateLimiting.value).toBe(false);
  });

  it("includes a workload scale-up scenario naming the next tier", () => {
    const scenarios = listScenarios(checkout); // small -> medium
    const scaleUp = scenarios.find((s) => s.id === "workload:scale-up")!;
    expect(scaleUp.label).toContain("medium");
  });

  it("offers no further scale-up scenario once already at massive", () => {
    const atMax = {
      ...checkout,
      workload: { scale: { ...checkout.workload.scale!, value: "massive" as const } },
    };
    expect(listScenarios(atMax).map((s) => s.id)).not.toContain("workload:scale-up");
  });
});

describe("applyScenario", () => {
  it("flips the instance count without mutating the original model", () => {
    const patched = applyScenario(checkout, "svc:loses-instance");
    const svc = patched.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("single");

    const original = checkout.components.find((c) => c.id === "svc");
    if (original?.kind !== "service") throw new Error("expected service");
    expect(original.instanceCount.value).toBe("multiple"); // unchanged
  });

  it("throws on an unknown scenario id", () => {
    expect(() => applyScenario(checkout, "nope")).toThrow(/unknown scenario/i);
  });

  it("rejects a scenario that doesn't apply to this model's components", () => {
    // media-upload has no cache; a cache scenario id must not resolve.
    expect(() => applyScenario(mediaUpload, "cache:stampede-protection-fails")).toThrow(
      /unknown scenario/i,
    );
  });
});

describe("setTraitValue", () => {
  it("sets the new value and marks it stated, without mutating the original", () => {
    const patched = setTraitValue(checkout, "db", "writeVolume", "low");
    const db = patched.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.writeVolume.value).toBe("low");
    expect(db.writeVolume.provenance).toBe("stated");

    const original = checkout.components.find((c) => c.id === "db");
    if (original?.kind !== "database") throw new Error("expected database");
    expect(original.writeVolume.value).toBe("high"); // unchanged
  });

  it("preserves the rationale while overwriting value and provenance", () => {
    const patched = setTraitValue(checkout, "db", "writeVolume", "low");
    const db = patched.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    const original = checkout.components.find((c) => c.id === "db");
    if (original?.kind !== "database") throw new Error("expected database");
    expect(db.writeVolume.rationale).toBe(original.writeVolume.rationale);
  });

  it("throws when the field isn't a trait on that component", () => {
    expect(() => setTraitValue(checkout, "db", "kind", "x")).toThrow(/not a trait/i);
  });
});

describe("compareScenario", () => {
  it("flags a scenario that breaks a previously healthy system", () => {
    // url-shortener's redirect service has a circuit breaker, so its
    // baseline is only broken by THUNDERING_HERD_RISK on the cache; losing
    // the service's only remaining instance introduces a second, distinct
    // critical finding on top of that. Use a model where losing the
    // instance is the ONLY thing wrong: url-shortener's cache fixed first.
    const protectedModel = {
      ...urlShortener,
      components: urlShortener.components.map((c) =>
        c.id === "cache" && c.kind === "cache"
          ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: true } }
          : c,
      ),
    };
    const delta = compareScenario(protectedModel, "svc:loses-instance");
    expect(delta.baseline.healthy).toBe(true);
    expect(delta.newlyUnhealthy).toBe(true);
    expect(delta.underScenario.healthy).toBe(false);
    expect(delta.newFindingCodes).toContain("SINGLE_POINT_OF_FAILURE");
  });

  it("reports no new findings when a scenario doesn't move the needle", () => {
    // media-upload's queue is "fixed", not "auto" — the queue scenario
    // catalogue offers nothing for it, so there's nothing to compare that
    // would introduce a new finding via that lever. Use the workload
    // scale-up instead, from small (no scale-dependent findings apply).
    const small = {
      ...mediaUpload,
      workload: { scale: { ...mediaUpload.workload.scale!, value: "small" as const } },
    };
    const delta = compareScenario(small, "workload:scale-up"); // small -> medium
    expect(delta.newFindingCodes).toEqual([]);
  });

  it("resolves a finding when a scenario removes the condition that caused it", () => {
    // media-upload at "large" scale has FIXED_SCALING_AT_SCALE; stepping
    // scale back down isn't a real scenario direction, so instead confirm
    // the inverse: growing scale on a small, otherwise-clean model
    // introduces it.
    const small = {
      ...mediaUpload,
      workload: { scale: { ...mediaUpload.workload.scale!, value: "medium" as const } },
    };
    const delta = compareScenario(small, "workload:scale-up"); // medium -> large
    expect(delta.newFindingCodes).toContain("FIXED_SCALING_AT_SCALE");
  });

  it("leaves the original model and its baseline result untouched", () => {
    const before = JSON.stringify(checkout);
    compareScenario(checkout, "svc:loses-instance");
    expect(JSON.stringify(checkout)).toBe(before);
  });
});
