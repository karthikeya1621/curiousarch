import type { Fix } from "@archsim/engine";

/**
 * Fix ids are "<componentId>:<kind>" (see fixes.ts's Fix.id doc comment) —
 * mirrors scenarioComponentId.ts's identical convention for scenarios.
 * Unlike scenarios, every fix targets exactly one component, so this never
 * returns null.
 */
export function fixComponentId(fix: Fix): string {
  return fix.id.split(":")[0]!;
}
