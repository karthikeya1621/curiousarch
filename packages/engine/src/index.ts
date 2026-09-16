/**
 * Public entrypoint. Consumers (apps/web) import from here, not from
 * individual files — this is the contract PLAN-1.2 establishes.
 *
 * Deliberately excludes src/inference/* (schema.ts, fromProse.ts, prompt.ts):
 * fromProse.ts pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY, which
 * must stay server-side. Nothing here should end up in a client bundle.
 */

export * from "./types.js";
export { simulate, findBreakingPoint } from "./solver.js";
export { listScenarios, applyScenario, compareScenario, withComponent } from "./whatif.js";
export type { Scenario, ScenarioDelta } from "./whatif.js";
export { listFixes, compareFix } from "./fixes.js";
export type { Fix, FixResult } from "./fixes.js";
export * from "../models/reference.js";
