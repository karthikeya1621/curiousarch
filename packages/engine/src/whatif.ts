/**
 * What-if scenarios: a hypothetical DEGRADATION of a model you already
 * have — never a new inferred model. Each scenario flips one trait toward
 * its riskier value (a replica failing, a rate limiter getting disabled),
 * or steps the workload up one scale tier. `compareScenario`'s diff logic
 * only ever operates on `Finding[]` from `simulate()` — it never depended
 * on numeric queueing math, which is exactly why this file barely changed
 * shape across the architect-pivot, only what each scenario's `apply` does.
 */

import { simulate } from "./solver.ts";
import { isTrait } from "./types.ts";
import type {
  Component,
  Edge,
  FindingCode,
  ScaleTier,
  SimulationResult,
  SystemModel,
} from "./types.ts";

export interface Scenario {
  /** Stable, unique id — "<componentId>:<kind>" or "workload:<kind>". */
  id: string;
  label: string;
  description: string;
  apply: (model: SystemModel) => SystemModel;
}

/** Exported for src/fixes.ts, which patches components the same way. */
export function withComponent(
  model: SystemModel,
  componentId: string,
  patch: (c: Component) => Component,
): SystemModel {
  return {
    ...model,
    components: model.components.map((c) => (c.id === componentId ? patch(c) : c)),
  };
}

/**
 * The structural counterpart to `withComponent`: adds a brand-new
 * component to the model rather than patching an existing one. `fixes.ts`
 * uses this for a fix whose real remedy is architectural (e.g. inserting a
 * caching layer) rather than a trait flip — `rewireIncoming` gets the
 * model's current edges and returns the edges the new model should have,
 * so the caller decides exactly how existing edges are redirected around
 * the new component.
 */
export function withInsertedComponent(
  model: SystemModel,
  newComponent: Component,
  rewireIncoming: (edges: Edge[]) => Edge[],
): SystemModel {
  return {
    ...model,
    components: [...model.components, newComponent],
    edges: rewireIncoming(model.edges),
  };
}

/**
 * Apply a user-supplied correction to one trait. Unlike scenarios (which
 * model a hypothetical stress), this records that the user just told the
 * tool the real fact — the edited field's provenance becomes "stated",
 * same as it would if it had been given up front.
 */
export function setTraitValue(
  model: SystemModel,
  componentId: string,
  field: string,
  value: string | boolean,
): SystemModel {
  return withComponent(model, componentId, (c) => {
    const record = c as unknown as Record<string, unknown>;
    const current = record[field];
    if (!isTrait(current)) {
      throw new Error(`"${field}" is not a trait on component "${componentId}".`);
    }
    return { ...c, [field]: { ...current, value, provenance: "stated" } } as Component;
  });
}

const SCALE_TIERS: ScaleTier[] = ["small", "medium", "large", "massive"];

// `scale` is optional on the type (the AI-driven flow doesn't produce it
// — see types.ts's Workload comment); every model this dormant scenario
// generator is actually called with (models/reference.ts's fixtures, via
// this file's own tests) always provides it.
function workloadScenarios(model: SystemModel): Scenario[] {
  if (!model.workload.scale) return [];
  const current = model.workload.scale.value;
  const idx = SCALE_TIERS.indexOf(current);
  if (idx === SCALE_TIERS.length - 1) return [];
  const next = SCALE_TIERS[idx + 1]!;
  return [
    {
      id: "workload:scale-up",
      label: `Traffic grows to ${next} scale`,
      description: `A sustained step up — real growth, not a spike — from ${current} to ${next}.`,
      apply: (m) => ({ ...m, workload: { ...m.workload, scale: { ...m.workload.scale!, value: next } } }),
    },
  ];
}

function scenariosForComponent(component: Component): Scenario[] {
  switch (component.kind) {
    case "gateway":
      if (!component.hasRateLimiting.value) return [];
      return [
        {
          id: `${component.id}:rate-limit-disabled`,
          label: `${component.label}: rate limiter is disabled`,
          description: "A misconfiguration or a deploy quietly turns off admission control.",
          apply: (model) =>
            withComponent(model, component.id, (c) =>
              c.kind === "gateway" ? { ...c, hasRateLimiting: { ...c.hasRateLimiting, value: false } } : c,
            ),
        },
      ];

    case "service":
      if (component.instanceCount.value !== "multiple") return [];
      return [
        {
          id: `${component.id}:loses-instance`,
          label: `${component.label}: loses all but one instance`,
          description: "An AZ outage or a bad deploy takes out the rest of the fleet.",
          apply: (model) =>
            withComponent(model, component.id, (c) =>
              c.kind === "service" ? { ...c, instanceCount: { ...c.instanceCount, value: "single" } } : c,
            ),
        },
      ];

    case "cache": {
      const scenarios: Scenario[] = [];
      if (component.hasStampedeProtection.value) {
        scenarios.push({
          id: `${component.id}:stampede-protection-fails`,
          label: `${component.label}: stampede protection fails`,
          description: "A bad deploy removes or bypasses the request-coalescing layer.",
          apply: (model) =>
            withComponent(model, component.id, (c) =>
              c.kind === "cache" ? { ...c, hasStampedeProtection: { ...c.hasStampedeProtection, value: false } } : c,
            ),
        });
      }
      return scenarios;
    }

    case "database":
      if (component.instanceCount.value !== "has-replicas") return [];
      return [
        {
          id: `${component.id}:replica-fails`,
          label: `${component.label}: the replica fails`,
          description: "A crash, a botched failover, or maintenance takes the only copy down to one.",
          apply: (model) =>
            withComponent(model, component.id, (c) =>
              c.kind === "database" ? { ...c, instanceCount: { ...c.instanceCount, value: "single" } } : c,
            ),
        },
      ];

    case "queue":
      if (component.consumerScaling.value !== "auto") return [];
      return [
        {
          id: `${component.id}:autoscaler-stuck`,
          label: `${component.label}: the autoscaler gets stuck`,
          description: "A quota limit or a stuck controller leaves the consumer pool fixed during a burst.",
          apply: (model) =>
            withComponent(model, component.id, (c) =>
              c.kind === "queue" ? { ...c, consumerScaling: { ...c.consumerScaling, value: "fixed" } } : c,
            ),
        },
      ];
  }
}

/** Every plausible degradation for this model, model-agnostic. */
export function listScenarios(model: SystemModel): Scenario[] {
  return [...workloadScenarios(model), ...model.components.flatMap(scenariosForComponent)];
}

export function applyScenario(model: SystemModel, scenarioId: string): SystemModel {
  const scenario = listScenarios(model).find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(
      `Unknown scenario "${scenarioId}". Run listScenarios(model) to see what applies to this model.`,
    );
  }
  return scenario.apply(model);
}

export interface ScenarioDelta {
  scenario: Scenario;
  baseline: SimulationResult;
  underScenario: SimulationResult;
  /** True only if the baseline was healthy and the scenario broke it. */
  newlyUnhealthy: boolean;
  newFindingCodes: FindingCode[];
  resolvedFindingCodes: FindingCode[];
}

/** Simulate a model both as-is and under one scenario, and diff the two. */
export function compareScenario(model: SystemModel, scenarioId: string): ScenarioDelta {
  const scenario = listScenarios(model).find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(
      `Unknown scenario "${scenarioId}". Run listScenarios(model) to see what applies to this model.`,
    );
  }

  const baseline = simulate(model);
  const underScenario = simulate(scenario.apply(model));

  const baselineCodes = new Set(baseline.findings.map((f) => f.code));
  const scenarioCodes = new Set(underScenario.findings.map((f) => f.code));

  return {
    scenario,
    baseline,
    underScenario,
    newlyUnhealthy: baseline.healthy && !underScenario.healthy,
    newFindingCodes: [...scenarioCodes].filter((c) => !baselineCodes.has(c)),
    resolvedFindingCodes: [...baselineCodes].filter((c) => !scenarioCodes.has(c)),
  };
}
