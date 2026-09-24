import type { SystemModel } from "@archsim/engine";
import type { PendingChatChange, PendingFix } from "../sessionStorage";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * What's pending, computed from the live model vs the model the findings
 * describe — so it reflects the CURRENT difference, not the history of how
 * it got there (moving a slider back clears it). Returns `null` when there
 * is no baseline to compare against; callers then fall back to latching.
 *
 * `findingsStale` means exactly "findings don't match the model" — a queued
 * fix or chat change doesn't change the model, so it makes Re-simulate
 * available (`canResimulate`) without making the findings stale.
 */
export function derivePending(
  model: SystemModel,
  baseline: SystemModel | null,
  pendingFixes: PendingFix[],
  pendingChanges: PendingChatChange[],
) {
  if (!baseline) return null;
  const parametersChanged = !deepEqual(model.workload, baseline.workload);
  const architectureChanged =
    !deepEqual(model.components, baseline.components) || !deepEqual(model.edges, baseline.edges);
  return {
    parametersChangedSinceResimulate: parametersChanged,
    chatChangeSinceResimulate: architectureChanged,
    findingsStale: parametersChanged || architectureChanged,
    canResimulate: parametersChanged || architectureChanged || pendingFixes.length > 0 || pendingChanges.length > 0,
  };
}
