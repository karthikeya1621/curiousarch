/**
 * Fix catalogue: for a pattern a component matched, what's the deterministic
 * remediation — flip the trait toward its safer value — and does applying
 * it actually clear the pattern when re-simulated.
 *
 * This is the third leg of the flow: indicator (every node with a possible
 * failure) -> failures (src/whatif.ts's Scenario catalogue) -> fixes (this
 * file) -> resimulate. No new facts are invented anywhere in this file —
 * every fix is a fixed, hand-written trait flip, same as the original
 * "hand-written catalogue keyed by finding code, not a model" principle.
 * The LLM's job, if this reaches the UI, is ranking these and writing one
 * sentence of explanation — never inventing the transform or the tradeoff.
 *
 * Fixes are looked up by the finding code a failure scenario actually
 * produces when simulated, not hardcoded per scenario — the same
 * SINGLE_POINT_OF_FAILURE fix applies whether the instance was lost to a
 * scenario or was already single at baseline.
 */

import { simulate } from "./solver.ts";
import { listScenarios, withComponent, withInsertedComponent, type Scenario } from "./whatif.ts";
import { trait } from "./types.ts";
import type { Component, FindingCode, SimulationResult, SystemModel } from "./types.ts";

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
/**
 * `component` lets a factory switch on kind or on the component's other
 * traits — CASCADING_FAILURE_RISK's factory needs it to find which service
 * in a chain to add a circuit breaker to; SINGLE_POINT_OF_FAILURE's needs
 * it to phrase a database fix differently from a service fix.
 */
type FixFactory = (componentId: string, component: Component, model: SystemModel) => FixTemplate[];

const FIX_CATALOG: Partial<Record<FindingCode, FixFactory>> = {
  SINGLE_POINT_OF_FAILURE: (componentId, component) => {
    if (component.kind === "service") {
      return [
        {
          id: `${componentId}:add-instance`,
          label: "Add a second instance",
          tradeoff: "Doubles compute cost for this service; only helps if what it calls downstream can also absorb another instance's worth of traffic.",
          apply: (model) =>
            withComponent(model, componentId, (c) =>
              c.kind === "service" ? { ...c, instanceCount: { ...c.instanceCount, value: "multiple" } } : c,
            ),
        },
      ];
    }
    if (component.kind === "database") {
      return [
        {
          id: `${componentId}:add-replica`,
          label: "Add a read replica",
          tradeoff: "Added infrastructure cost, and replication lag becomes a new (smaller) risk to watch — but a crash no longer means data loss.",
          apply: (model) =>
            withComponent(model, componentId, (c) =>
              c.kind === "database" ? { ...c, instanceCount: { ...c.instanceCount, value: "has-replicas" } } : c,
            ),
        },
      ];
    }
    return [];
  },

  THUNDERING_HERD_RISK: (componentId) => [
    {
      id: `${componentId}:stampede-protection`,
      label: "Add stampede protection (request coalescing)",
      tradeoff: "Real engineering work — one in-flight refill per key, everyone else waits on it — not a config toggle.",
      apply: (model) =>
        withComponent(model, componentId, (c) =>
          c.kind === "cache" ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: true } } : c,
        ),
    },
    {
      id: `${componentId}:lengthen-ttl`,
      label: "Lengthen the cache TTL",
      tradeoff: "Serves staler data for longer — only safe if your staleness tolerance allows it, and it reduces frequency without fixing the coincidence if it does expire.",
      apply: (model) =>
        withComponent(model, componentId, (c) => (c.kind === "cache" ? { ...c, ttl: { ...c.ttl, value: "long" } } : c)),
    },
  ],

  /**
   * The only fix in this catalogue that targets a DIFFERENT component than
   * the one the finding is attached to: the finding sits on the chain's
   * tail (the deepest dependency), but a circuit breaker belongs on the
   * calling service. Walks the model's edges backward from the tail to
   * find the nearest upstream service.
   */
  CASCADING_FAILURE_RISK: (componentId, _component, model) => {
    const byId = new Map(model.components.map((c) => [c.id, c]));
    let current = componentId;
    const guarded = new Set<string>();
    for (let i = 0; i < model.components.length; i++) {
      const upstreamEdge = model.edges.find((e) => e.to === current);
      if (!upstreamEdge) break;
      const upstream = byId.get(upstreamEdge.from);
      if (upstream?.kind === "service" && !guarded.has(upstream.id)) {
        guarded.add(upstream.id);
      }
      current = upstreamEdge.from;
    }
    return [...guarded].map((serviceId) => ({
      id: `${serviceId}:add-circuit-breaker`,
      label: `Add a circuit breaker on ${serviceId}'s downstream calls`,
      tradeoff: "Failures now surface as fast errors instead of hangs once the breaker trips — callers must handle that, not just retry blindly.",
      apply: (m: SystemModel) =>
        withComponent(m, serviceId, (c) =>
          c.kind === "service" ? { ...c, hasCircuitBreaker: { ...c.hasCircuitBreaker, value: true } } : c,
        ),
    }));
  },

  UNBOUNDED_ADMISSION: (componentId) => [
    {
      id: `${componentId}:add-rate-limiting`,
      label: "Add rate limiting",
      tradeoff: "Legitimate bursts get throttled too unless the limit is tuned generously — better than nothing reaching downstream at all.",
      apply: (model) =>
        withComponent(model, componentId, (c) =>
          c.kind === "gateway" ? { ...c, hasRateLimiting: { ...c.hasRateLimiting, value: true } } : c,
        ),
    },
  ],

  QUEUE_NO_DEAD_LETTER: (componentId) => [
    {
      id: `${componentId}:add-dlq`,
      label: "Add a dead-letter queue",
      tradeoff: "Poison messages stop blocking the pipeline, but now need a separate process to inspect and reprocess them — set up and forgotten, a DLQ just grows.",
      apply: (model) =>
        withComponent(model, componentId, (c) =>
          c.kind === "queue" ? { ...c, hasDeadLetterQueue: { ...c.hasDeadLetterQueue, value: true } } : c,
        ),
    },
  ],

  FIXED_SCALING_AT_SCALE: (componentId) => [
    {
      id: `${componentId}:autoscale-consumers`,
      label: "Switch to autoscaling consumers",
      tradeoff: "More moving parts (scaling policy, cooldowns to tune) in exchange for absorbing bursts instead of falling behind.",
      apply: (model) =>
        withComponent(model, componentId, (c) =>
          c.kind === "queue" ? { ...c, consumerScaling: { ...c.consumerScaling, value: "auto" } } : c,
        ),
    },
  ],

  /**
   * The one fix in this catalogue whose remedy is structural, not a trait
   * flip — there's no existing trait that means "has a cache in front of
   * it." Inserts a brand-new cache component between the database and
   * whatever currently calls it directly, rewiring the edge(s) around it.
   * The new cache ships with safe defaults (long TTL, large keyspace,
   * stampede protection on) specifically so this fix doesn't just relocate
   * the problem into a fresh THUNDERING_HERD_RISK on the cache it just
   * added.
   */
  UNCACHED_DATABASE_AT_SCALE: (componentId, component) => {
    if (component.kind !== "database") return [];
    const cacheId = `${componentId}-cache`;
    return [
      {
        id: `${componentId}:add-cache`,
        label: "Add a caching layer",
        tradeoff: "One more moving part to run and keep warm, and cached data can go briefly stale — but repeat reads stop reaching the database at all.",
        apply: (model) =>
          withInsertedComponent(
            model,
            {
              id: cacheId,
              label: `${component.label} cache`,
              kind: "cache",
              ttl: trait("long", "default", "Long TTL by default — a freshly added cache shouldn't itself become a thundering-herd risk."),
              keyspaceSize: trait("large", "default", "Assumed large until proven otherwise."),
              hasStampedeProtection: trait(true, "default", "Request coalescing on by default, for the same reason."),
            },
            (edges) => [
              ...edges.filter((e) => e.to !== componentId),
              ...edges.filter((e) => e.to === componentId).map((e) => ({ from: e.from, to: cacheId })),
              { from: cacheId, to: componentId },
            ],
          ),
      },
    ];
  },
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

  const failureModel = scenario.apply(model);
  const underFailure = simulate(failureModel);
  const fixes: Fix[] = [];
  const seen = new Set<string>();
  for (const finding of underFailure.findings) {
    const factory = FIX_CATALOG[finding.code];
    if (!factory) continue;
    // Scenarios never change a component's id, kind, or the model's edges
    // (whatif.ts's scenarios only flip trait values) — looking the
    // component up on the original model is safe even though the finding
    // came from simulating the model under the scenario. Passed alongside
    // `failureModel` itself for factories (like CASCADING_FAILURE_RISK's)
    // that need to walk edges to find a different component to fix.
    const component = model.components.find((c) => c.id === finding.componentId);
    if (!component) continue;
    for (const template of factory(finding.componentId, component, failureModel)) {
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
