/**
 * How far the scale controls may move in one go. The ladders step by ~100x, so
 * a jump of two rungs (100 -> 1M) is four orders of magnitude at once: the
 * Re-simulate that follows fixes everything in one pass, nothing visibly
 * breaks, and the "raise the scale, see what fails, fix it" loop this tool
 * exists for never happens (seen on a real project: one scale-up switched on
 * every protection, and the review afterwards had almost nothing to find).
 * One rung above the last simulated tier is the most a single Re-simulate
 * covers; lowering is always allowed.
 */

/** The highest tier reachable from `baselineTier`: one rung up the ladder. No restriction (the top of the ladder) when there is no baseline or it isn't on the ladder. */
export function highestReachableTier(ladder: readonly number[], baselineTier: number | undefined): number {
  const top = ladder[ladder.length - 1]!;
  if (baselineTier === undefined) return top;
  const at = ladder.indexOf(baselineTier);
  if (at === -1) return top;
  return ladder[Math.min(at + 1, ladder.length - 1)]!;
}

/** Clamps a requested tier to what's reachable from the baseline. */
export function clampTier(ladder: readonly number[], baselineTier: number | undefined, requested: number): number {
  return Math.min(requested, highestReachableTier(ladder, baselineTier));
}
