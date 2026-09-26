import { describe, expect, it } from "vitest";
import { atLowestTier, checkLowestTierMinimal, startMinimal } from "../src/inference/startMinimal.js";

const trait = (value: unknown, provenance: string, rationale = "Because.") => ({ value, provenance, rationale });
const low = { users: { included: true, tier: 100, target: 1_000_000 }, requests: { included: false, tier: 1000, target: 1000 } };
const comps = () => [
  { id: "gw", kind: "gateway", hasRateLimiting: trait(true, "default", "Typical for a public gateway.") },
  { id: "svc", kind: "service", instanceCount: trait("single", "default"), hasCircuitBreaker: trait(true, "stated", "The description says calls are wrapped in breakers.") },
  { id: "pay", kind: "external-dependency", hasTimeout: trait(true, "inferred", "The prose mentions a 5 second limit."), hasFallback: trait(false, "default") },
  { id: "q", kind: "queue", hasDeadLetterQueue: trait(true, "default", "Usual practice."), consumerScaling: trait("auto", "default") },
];

describe("atLowestTier", () => {
  it("is true only when every dimension in use is on the bottom rung and at least one is in use", () => {
    expect(atLowestTier(low)).toBe(true);
    expect(atLowestTier({ ...low, users: { included: true, tier: 10_000, target: 1_000_000 } })).toBe(false);
    expect(atLowestTier({ users: { included: true, tier: 100, target: 100 }, requests: { included: true, tier: 100_000, target: 100_000 } })).toBe(false);
    expect(atLowestTier({})).toBe(false);
  });
});

describe("startMinimal", () => {
  it("switches off a protection the model chose itself ('default') at the lowest tier, with a rationale that no longer contradicts it", () => {
    const [gw, , , q] = startMinimal(comps(), low as never) as Record<string, any>[];
    expect(gw!.hasRateLimiting).toEqual({ value: false, provenance: "default", rationale: "Not mentioned in the description; a launch starts without it." });
    expect(q!.hasDeadLetterQueue.value).toBe(false);
  });

  it("switches off a protection that was only 'inferred' (\"it should guard against slow calls\" is a recommendation, not a fact), and keeps one the description STATES", () => {
    const [, svc, pay] = startMinimal(comps(), low as never) as Record<string, any>[];
    expect(svc!.hasCircuitBreaker.value).toBe(true); // stated
    expect(pay!.hasTimeout).toEqual({ value: false, provenance: "default", rationale: "Not mentioned in the description; a launch starts without it." }); // inferred -> off
  });

  it("keeps every non-protection trait", () => {
    const [, svc, , q] = startMinimal(comps(), low as never) as Record<string, any>[];
    expect(svc!.instanceCount.value).toBe("single");
    expect(q!.consumerScaling.value).toBe("auto");
  });

  it("does nothing above the lowest tier, and returns the same objects when nothing needs changing", () => {
    const input = comps();
    expect(startMinimal(input, { ...low, users: { included: true, tier: 10_000, target: 1_000_000 } } as never)).toBe(input);
    const untouched = [input[1]!]; // its only protection is stated
    expect(startMinimal(untouched, low as never)[0]).toBe(untouched[0]);
  });
});

describe("checkLowestTierMinimal — names what scales beyond the minimum at the lowest tier, for the AI to repair", () => {
  const scaled = [
    { id: "svc", kind: "service", instanceCount: trait("multiple", "inferred") },
    { id: "db", kind: "database", instanceCount: trait("has-replicas", "inferred") },
    { id: "q", kind: "queue", consumerScaling: trait("auto", "inferred") },
    { id: "kept", kind: "service", instanceCount: trait("multiple", "stated") },
    { id: "min", kind: "service", instanceCount: trait("single", "default") },
  ];

  it("lists every inferred value above the minimum, and leaves a stated one and a minimal one out", () => {
    const problem = checkLowestTierMinimal(scaled, low as never)!;
    expect(problem).toMatch(/svc\.instanceCount is "multiple"/);
    expect(problem).toMatch(/db\.instanceCount is "has-replicas"/);
    expect(problem).toMatch(/q\.consumerScaling is "auto"/);
    expect(problem).not.toMatch(/kept|"min"/);
  });

  it("is quiet when nothing exceeds the minimum, and above the lowest tier", () => {
    expect(checkLowestTierMinimal([scaled[3]!, scaled[4]!], low as never)).toBeNull();
    expect(checkLowestTierMinimal(scaled, { ...low, users: { included: true, tier: 10_000, target: 1_000_000 } } as never)).toBeNull();
  });
});
