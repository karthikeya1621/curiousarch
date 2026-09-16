/**
 * What-if scenarios: structural or magnitude perturbations to a model you
 * already have, not new inferred parameters.
 *
 * PLAN-0.4 found that inferring absolute duration/capacity numbers from
 * prose is unreliable — bottleneck identity correct in only 30% of runs.
 * That failure is specific to getting an absolute number right (is this
 * query 15ms or 40ms?). It does not implicate the engine's queueing math,
 * which the golden tests hold to a real hand-derived standard. A relative
 * question — "what happens to THIS model if traffic triples, or a cache
 * goes cold, or half the fleet disappears" — only needs the mechanism to be
 * sound, not the baseline's absolute numbers to be exactly right. That is
 * what this module answers: given a model (however it was built), enumerate
 * plausible failure/stress scenarios, apply one, and diff the result against
 * the baseline.
 *
 * Findings are still computed by `simulate()`, never generated here — this
 * module only patches parameters and re-runs the same engine.
 */

import { simulate } from "./solver.ts";
import type { Component, FindingCode, SimulationResult, SystemModel } from "./types.ts";

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

function trafficScenarios(model: SystemModel): Scenario[] {
  return [2, 5, 10].map((factor) => ({
    id: `workload:traffic-${factor}x`,
    label: `Traffic spikes to ${factor}x (${Math.round(model.workload.rps * factor).toLocaleString()} rps)`,
    description: `A sudden ${factor}x surge — a sale, a viral post, a retry storm.`,
    apply: (m) => ({ ...m, workload: { ...m.workload, rps: m.workload.rps * factor } }),
  }));
}

function scenariosForComponent(component: Component): Scenario[] {
  switch (component.kind) {
    case "gateway":
      // No failure mode of its own beyond traffic, which trafficScenarios
      // already covers.
      return [];

    case "service":
      return [
        {
          id: `${component.id}:instance-loss-50`,
          label: `${component.label}: loses half its instances`,
          description: "An AZ outage or a bad deploy takes out half the fleet.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "service") return c;
              return {
                ...c,
                instances: {
                  ...c.instances,
                  value: Math.max(1, Math.floor(c.instances.value / 2)),
                },
              };
            }),
        },
        {
          id: `${component.id}:latency-spike-2x`,
          label: `${component.label}: service time doubles`,
          description: "A GC pause, a noisy neighbor, or a slow dependency call.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "service") return c;
              return {
                ...c,
                serviceTimeMs: { ...c.serviceTimeMs, value: c.serviceTimeMs.value * 2 },
              };
            }),
        },
      ];

    case "cache":
      return [
        {
          id: `${component.id}:cold`,
          label: `${component.label}: goes cold`,
          description: "A flush or a redeploy wipes the cache; hit rate collapses.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "cache") return c;
              return { ...c, hitRate: { ...c.hitRate, value: 0.02 } };
            }),
        },
        {
          id: `${component.id}:slow-op-10x`,
          label: `${component.label}: per-op time rises 10x`,
          description: "Memory pressure or a noisy neighbor slows every operation.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "cache") return c;
              return { ...c, cpuTimeMs: { ...c.cpuTimeMs, value: c.cpuTimeMs.value * 10 } };
            }),
        },
      ];

    case "database":
      return [
        {
          id: `${component.id}:query-latency-2x`,
          label: `${component.label}: query time doubles`,
          description: "A missing index, lock contention, or a noisy neighbor.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "database") return c;
              return { ...c, queryTimeMs: { ...c.queryTimeMs, value: c.queryTimeMs.value * 2 } };
            }),
        },
        {
          id: `${component.id}:pool-shrink-50`,
          label: `${component.label}: connection pool halves`,
          description: "A leak, a misconfiguration, or a failover shrinks the pool.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "database") return c;
              return {
                ...c,
                connectionPoolSize: {
                  ...c.connectionPoolSize,
                  value: Math.max(1, Math.floor(c.connectionPoolSize.value / 2)),
                },
              };
            }),
        },
        {
          id: `${component.id}:write-spike-2x`,
          label: `${component.label}: write share doubles`,
          description: "A bulk import or backfill job temporarily spikes writes.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "database") return c;
              return {
                ...c,
                writeRatio: { ...c.writeRatio, value: Math.min(1, c.writeRatio.value * 2) },
              };
            }),
        },
      ];

    case "queue":
      return [
        {
          id: `${component.id}:consumer-loss-50`,
          label: `${component.label}: loses half its consumers`,
          description: "A deploy, a crash loop, or a scale-down takes out half the workers.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "queue") return c;
              return {
                ...c,
                consumers: {
                  ...c.consumers,
                  value: Math.max(1, Math.floor(c.consumers.value / 2)),
                },
              };
            }),
        },
        {
          id: `${component.id}:consumer-slowdown-2x`,
          label: `${component.label}: per-job time doubles`,
          description: "A slow downstream dependency or larger jobs than usual.",
          apply: (model) =>
            withComponent(model, component.id, (c) => {
              if (c.kind !== "queue") return c;
              return {
                ...c,
                consumerServiceTimeMs: {
                  ...c.consumerServiceTimeMs,
                  value: c.consumerServiceTimeMs.value * 2,
                },
              };
            }),
        },
      ];
  }
}

/** Every plausible failure/stress scenario for this model, model-agnostic. */
export function listScenarios(model: SystemModel): Scenario[] {
  return [...trafficScenarios(model), ...model.components.flatMap(scenariosForComponent)];
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
  endToEndMeanDeltaMs: number;
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
    endToEndMeanDeltaMs: underScenario.endToEndMeanMs - baseline.endToEndMeanMs,
  };
}
