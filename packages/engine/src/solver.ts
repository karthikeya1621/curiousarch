/**
 * Orchestration: validate the model's shape, run every pattern against it,
 * decide healthy/unhealthy. The actual judgment — what's wrong and why —
 * lives entirely in patterns.ts. No text is generated here and no LLM is
 * involved; that boundary is the product.
 */

import { evaluatePatterns } from "./patterns.ts";
import type { ScaleTier, SystemModel, SimulationResult } from "./types.ts";

/** Kahn's algorithm, run for feasibility only — patterns.ts's chain walk assumes a DAG. */
function assertAcyclic(model: SystemModel): void {
  const indegree = new Map(model.components.map((c) => [c.id, 0]));
  for (const edge of model.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = model.components.filter((c) => indegree.get(c.id) === 0).map((c) => c.id);
  let visited = 0;

  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const edge of model.edges.filter((e) => e.from === id)) {
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }

  if (visited !== model.components.length) {
    throw new Error(
      "Model contains a cycle. Retries and circuit breakers are modelled as " +
        "a trait, not as an edge back into an upstream component.",
    );
  }
}

export function simulate(model: SystemModel): SimulationResult {
  assertAcyclic(model);
  const findings = evaluatePatterns(model);
  return {
    modelId: model.id,
    findings,
    healthy: !findings.some((f) => f.severity === "critical"),
  };
}

const SCALE_TIERS: ScaleTier[] = ["small", "medium", "large", "massive"];

// `model.workload.scale` is optional on the type (see types.ts's Workload
// comment — the AI-driven flow doesn't produce it) but every model this
// dormant function is actually ever called with (models/reference.ts's
// fixtures, via this file's own tests) always provides it.
function withScale(model: SystemModel, scale: ScaleTier): SystemModel {
  return { ...model, workload: { ...model.workload, scale: { ...model.workload.scale!, value: scale } } };
}

/**
 * Step through the four scale tiers and report the first one that breaks —
 * the rough-mode equivalent of the old binary search over rps. The question
 * is still "where does this fall over", just answered in tiers instead of
 * an exact number nobody could have measured anyway.
 */
export function findBreakingTier(
  model: SystemModel,
): { scale: ScaleTier; findings: SimulationResult["findings"] } | null {
  for (const scale of SCALE_TIERS) {
    const result = simulate(withScale(model, scale));
    if (!result.healthy) return { scale, findings: result.findings };
  }
  return null;
}
