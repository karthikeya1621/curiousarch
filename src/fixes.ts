/**
 * Fix catalogue: for a failure a node could plausibly suffer, what are the
 * deterministic remediations, each with a stated tradeoff — and does
 * applying one actually resolve it when re-simulated.
 *
 * This is the third leg of the flow: indicator (every node with a possible
 * failure) -> failures (src/whatif.ts's Scenario catalogue) -> fixes (this
 * file) -> resimulate. No new numbers are inferred anywhere in this file —
 * every fix is a fixed, hand-written multiplier on whatever the model
 * already has, same as PLAN-1.6's "hand-written catalogue keyed by finding
 * code, not a model." The LLM's job, if this reaches Phase 1, is ranking
 * these and writing one sentence of explanation — never inventing the
 * transform or the tradeoff text.
 *
 * Fixes are looked up by the finding code a failure scenario actually
 * produces when simulated, not hardcoded per scenario — the same
 * CONNECTION_POOL_EXHAUSTED fix applies whether the pool got exhausted by a
 * traffic spike or a query-latency scenario.
 */

import { simulate } from "./solver.js";
import { listScenarios, withComponent, type Scenario } from "./whatif.js";
import type { Component, FindingCode, SimulationResult, SystemModel } from "./types.js";

export interface Fix {
  /** "<componentId>:<kind>" — stable, unique per component. */
  id: string;
  label: string;
  /** What this costs — money, risk, or engineering effort. Never omitted. */
  tradeoff: string;
  /** The specific finding this fix is meant to clear — see FixResult.resolved. */
  targetsFindingCode: FindingCode;
  apply: (model: SystemModel) => SystemModel;
}

type FixTemplate = Omit<Fix, "targetsFindingCode">;
type FixFactory = (componentId: string) => FixTemplate[];

function scale(component: Component, field: string, factor: number): Component {
  const c = component as unknown as Record<string, { value: number; unit: string; provenance: string; rationale: string }>;
  const param = c[field]!;
  return { ...component, [field]: { ...param, value: param.value * factor } } as Component;
}

const FIX_CATALOG: Partial<Record<FindingCode, FixFactory>> = {
  CONNECTION_POOL_EXHAUSTED: (componentId) => [
    {
      id: `${componentId}:pool-2x`,
      label: "Double the connection pool",
      tradeoff:
        "More memory and file descriptors on the database server; can hit the database's own connection ceiling. An external pooler (PgBouncer) often gets the same effect without provisioning more raw connections.",
      apply: (model) =>
        withComponent(model, componentId, (c) =>
          c.kind === "database" ? scale(c, "connectionPoolSize", 2) : c,
        ),
    },
    {
      id: `${componentId}:query-time-half`,
      label: "Halve query time (add an index, optimize the query)",
      tradeoff: "Real engineering work, not a config change — not always possible without schema or access-pattern changes.",
      apply: (model) =>
        withComponent(model, componentId, (c) => (c.kind === "database" ? scale(c, "queryTimeMs", 0.5) : c)),
    },
  ],

  SERVICE_SATURATED: (componentId) => [
    {
      id: `${componentId}:instances-2x`,
      label: "Double the instance count",
      tradeoff: "Doubles compute cost for this service; only helps if what it calls downstream can absorb the added throughput too.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "service" ? scale(c, "instances", 2) : c)),
    },
    {
      id: `${componentId}:service-time-half`,
      label: "Halve service time (optimize the hot path)",
      tradeoff: "Profiling and optimization work, not a scaling knob — and not always achievable.",
      apply: (model) =>
        withComponent(model, componentId, (c) => (c.kind === "service" ? scale(c, "serviceTimeMs", 0.5) : c)),
    },
  ],

  CACHE_SATURATED: (componentId) => [
    {
      id: `${componentId}:cpu-time-half`,
      label: "Halve per-op processing time (faster cache tier, smaller payloads)",
      tradeoff: "May require migrating to a faster cache tier or shrinking cached values — infrastructure or engineering cost, not free.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "cache" ? scale(c, "cpuTimeMs", 0.5) : c)),
    },
  ],

  QUEUE_OVERFLOW: (componentId) => [
    {
      id: `${componentId}:consumers-2x`,
      label: "Double the consumer count",
      tradeoff: "More worker cost; only helps if whatever consumers call downstream can absorb the added throughput.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "queue" ? scale(c, "consumers", 2) : c)),
    },
    {
      id: `${componentId}:capacity-2x`,
      label: "Double the queue's retention capacity",
      tradeoff: "Buys time, not throughput — delays the overflow rather than fixing the drain-rate deficit that causes it.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "queue" ? scale(c, "capacity", 2) : c)),
    },
  ],

  REPLICATION_LAG: (componentId) => [
    {
      id: `${componentId}:apply-rate-2x`,
      label: "Double the replica apply rate (faster replica hardware)",
      tradeoff: "Requires bigger/faster replica instances, or reducing what's replicated — added infrastructure cost.",
      apply: (model) =>
        withComponent(model, componentId, (c) => (c.kind === "database" ? scale(c, "replicaApplyRate", 2) : c)),
    },
  ],

  GATEWAY_LIMIT_EXCEEDED: (componentId) => [
    {
      id: `${componentId}:max-rps-2x`,
      label: "Double the gateway's admission ceiling",
      tradeoff: "Often a soft account limit, not a technical one — check with your provider before assuming it's raisable, and confirm downstream can absorb the extra traffic.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "gateway" ? scale(c, "maxRps", 2) : c)),
    },
  ],

  THUNDERING_HERD: (componentId) => [
    {
      id: `${componentId}:ttl-2x`,
      label: "Double the cache TTL",
      tradeoff: "Serves staler data for longer — only safe if your staleness tolerance allows it.",
      apply: (model) => withComponent(model, componentId, (c) => (c.kind === "cache" ? scale(c, "ttlSeconds", 2) : c)),
    },
  ],
};

/**
 * Fixes for whatever a failure scenario actually breaks — simulates the
 * scenario first and looks up the catalogue by the findings it produces, so
 * the same fix applies regardless of which scenario caused that finding.
 * Empty if the scenario doesn't break anything at the model's current load.
 */
export function listFixes(model: SystemModel, scenarioId: string): Fix[] {
  const scenario = listScenarios(model).find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioId}". Run listScenarios(model) to see options.`);
  }

  const underFailure = simulate(scenario.apply(model));
  const fixes: Fix[] = [];
  const seen = new Set<string>();
  for (const finding of underFailure.findings) {
    const factory = FIX_CATALOG[finding.code];
    if (!factory) continue;
    for (const template of factory(finding.componentId)) {
      if (seen.has(template.id)) continue;
      seen.add(template.id);
      fixes.push({ ...template, targetsFindingCode: finding.code });
    }
  }
  return fixes;
}

export interface FixResult {
  scenario: Scenario;
  fix: Fix;
  baseline: SimulationResult;
  underFailure: SimulationResult;
  underFix: SimulationResult;
  /**
   * True only if the specific finding this fix targets is gone after
   * applying it — not a blanket "everything is healthy now." A fix can
   * resolve what it targets while an unrelated finding (caused by the same
   * failure scenario, or already present at baseline) persists; that's
   * still real progress, and collapsing it into "not resolved" would hide
   * that from anyone using this to reason about a fix's actual effect.
   */
  resolved: boolean;
}

/** Apply a failure scenario, then a fix on top of it, and simulate all three states. */
export function compareFix(model: SystemModel, scenarioId: string, fixId: string): FixResult {
  const scenario = listScenarios(model).find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioId}". Run listScenarios(model) to see options.`);
  }
  const fix = listFixes(model, scenarioId).find((f) => f.id === fixId);
  if (!fix) {
    throw new Error(`Unknown fix "${fixId}" for scenario "${scenarioId}". Run listFixes(model, scenarioId) to see options.`);
  }

  const failureModel = scenario.apply(model);
  const baseline = simulate(model);
  const underFailure = simulate(failureModel);
  const underFix = simulate(fix.apply(failureModel));

  const targetedFailurePresent = underFailure.findings.some(
    (f) => f.code === fix.targetsFindingCode,
  );
  const targetedFailureStillPresent = underFix.findings.some(
    (f) => f.code === fix.targetsFindingCode,
  );

  return {
    scenario,
    fix,
    baseline,
    underFailure,
    underFix,
    resolved: targetedFailurePresent && !targetedFailureStillPresent,
  };
}
