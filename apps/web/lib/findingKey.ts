import type { AiFinding } from "@archsim/engine";

/**
 * `AiFinding` has no id of its own (it's freshly generated every
 * `identifyFailures` call, never persisted) — this is the stable key used
 * to select one in the store and match it back out of `findings`, mirroring
 * the dormant engine's own `scenarioComponentId` pattern.
 */
export function findingKey(finding: AiFinding): string {
  return `${finding.componentId}:${finding.code}`;
}
