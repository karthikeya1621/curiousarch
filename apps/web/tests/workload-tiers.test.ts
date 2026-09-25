import { describe, expect, it } from "vitest";
import { USER_TIERS } from "@archsim/engine";
import { clampTier, highestReachableTier } from "../lib/workloadTiers";

describe("highestReachableTier", () => {
  it("is one rung above the baseline, and stops at the top of the ladder", () => {
    expect(highestReachableTier(USER_TIERS, 100)).toBe(10_000);
    expect(highestReachableTier(USER_TIERS, 10_000)).toBe(1_000_000);
    expect(highestReachableTier(USER_TIERS, 100_000_000)).toBe(100_000_000);
  });

  it("is unrestricted with no baseline, or one that isn't on the ladder", () => {
    expect(highestReachableTier(USER_TIERS, undefined)).toBe(100_000_000);
    expect(highestReachableTier(USER_TIERS, 12_345)).toBe(100_000_000);
  });
});

describe("clampTier", () => {
  it("lowers a too-big request to the reachable rung and leaves anything at or below it alone", () => {
    expect(clampTier(USER_TIERS, 100, 1_000_000)).toBe(10_000);
    expect(clampTier(USER_TIERS, 100, 10_000)).toBe(10_000);
    expect(clampTier(USER_TIERS, 10_000, 100)).toBe(100);
  });
});
