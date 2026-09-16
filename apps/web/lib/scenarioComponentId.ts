import type { Scenario } from "@archsim/engine";

/**
 * Scenario ids are "<componentId>:<kind>" for per-component failures, or
 * "workload:<kind>" for traffic-level ones (see whatif.ts's Scenario
 * catalogue). Ports bin/whatif.ts's id-prefix grouping into one place
 * instead of re-parsing the string at every call site.
 *
 * Returns null for a workload-level scenario — there's no single owning
 * component for "traffic spikes 5x".
 */
export function scenarioComponentId(scenario: Scenario): string | null {
  const prefix = scenario.id.split(":")[0]!;
  return prefix === "workload" ? null : prefix;
}
