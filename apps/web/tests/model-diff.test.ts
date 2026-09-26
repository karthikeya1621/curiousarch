import { describe, expect, it } from "vitest";
import type { SystemModel } from "@archsim/engine";
import { diffModels, summarizeDiff, unrequestedRemovals } from "../lib/modelDiff";

const trait = (value: unknown) => ({ value, provenance: "default", rationale: "Because." });
const comp = (id: string, kind: string, extra: object = {}) => ({ id, kind, label: id.toUpperCase(), ...extra });
const model = (components: object[], edges: [string, string][]): SystemModel =>
  ({ id: "m", name: "m", workload: {}, components, edges: edges.map(([from, to]) => ({ from, to })) }) as unknown as SystemModel;

const before = model(
  [comp("gw", "gateway", { hasRateLimiting: trait(false) }), comp("svc", "service", { instanceCount: trait("single") }), comp("db", "database")],
  [["gw", "svc"], ["svc", "db"]],
);

describe("diffModels", () => {
  it("reports added and removed components, changed trait values and changed connections", () => {
    const after = model(
      [comp("gw", "gateway", { hasRateLimiting: trait(true) }), comp("svc", "service", { instanceCount: trait("multiple") }), comp("cache", "cache")],
      [["gw", "svc"], ["svc", "cache"]],
    );
    const d = diffModels(before, after);
    expect(d.addedComponents.map((c) => c.id)).toEqual(["cache"]);
    expect(d.removedComponents.map((c) => c.id)).toEqual(["db"]);
    expect(d.changedTraits.map((t) => `${t.id}.${t.trait}: ${t.from} -> ${t.to}`)).toEqual([
      "gw.hasRateLimiting: false -> true",
      "svc.instanceCount: single -> multiple",
    ]);
    expect(d.addedEdges).toEqual([{ from: "svc", to: "cache" }]);
    expect(d.removedEdges).toEqual([{ from: "svc", to: "db" }]);
  });

  it("ignores a rewritten rationale or provenance when the value is the same", () => {
    const reworded = model(
      [comp("gw", "gateway", { hasRateLimiting: { value: false, provenance: "inferred", rationale: "Different words." } }), comp("svc", "service", { instanceCount: trait("single") }), comp("db", "database")],
      [["gw", "svc"], ["svc", "db"]],
    );
    expect(summarizeDiff(diffModels(before, reworded))).toBe("No changes");
  });
});

describe("summarizeDiff and unrequestedRemovals", () => {
  it("reads as one short line", () => {
    const after = model([comp("gw", "gateway", { hasRateLimiting: trait(true) }), comp("svc", "service", { instanceCount: trait("single") })], [["gw", "svc"]]);
    expect(summarizeDiff(diffModels(before, after))).toBe("−1 component, 1 value changed, 1 connection changed");
    expect(summarizeDiff(diffModels(after, before))).toBe("+1 component, 1 value changed, 1 connection changed");
  });

  it("counts a removal as unrequested only when nothing was queued", () => {
    const after = model([comp("gw", "gateway", { hasRateLimiting: trait(false) }), comp("svc", "service", { instanceCount: trait("single") })], [["gw", "svc"]]);
    const d = diffModels(before, after);
    expect(unrequestedRemovals(d, false).map((c) => c.id)).toEqual(["db"]);
    expect(unrequestedRemovals(d, true)).toEqual([]);
  });
});
