/**
 * Public entrypoint. Consumers (apps/web) import from here, not from
 * individual files — this is the contract PLAN-1.2 establishes.
 *
 * Deliberately excludes src/inference/* (schema.ts, fromProse.ts, prompt.ts):
 * fromProse.ts pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY, which
 * must stay server-side. Nothing here should end up in a client bundle.
 *
 * Every relative import here (and in every file it transitively pulls in —
 * solver.ts, components.ts, whatif.ts, fixes.ts) uses an explicit .ts
 * extension, not .js. Confirmed live: Turbopack cannot resolve a
 * .js-suffixed specifier pointing at a .ts file for this workspace package
 * at all — same-directory or cross-directory, it doesn't matter, and a
 * type-only import (which TypeScript elides entirely at runtime) will look
 * like it works and prove nothing. tsc/tsx/vitest accept .ts extensions
 * fine under moduleResolution: "bundler", so this is safe everywhere.
 * Files only reached via tsx/vitest (tests/, bin/) are unaffected by this
 * and were deliberately left on .js — no reason to touch what already works.
 */

export * from "./types.ts";
export { simulate, findBreakingTier } from "./solver.ts";
export { isAsyncBoundary } from "./components.ts";
export {
  listScenarios,
  applyScenario,
  compareScenario,
  withComponent,
  setTraitValue,
} from "./whatif.ts";
export type { Scenario, ScenarioDelta } from "./whatif.ts";
export { listFixes, compareFix } from "./fixes.ts";
export type { Fix, FixResult } from "./fixes.ts";
export * from "../models/reference.ts";
