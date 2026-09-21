/**
 * Server-only entrypoint. Pulls in @anthropic-ai/sdk and reads
 * ANTHROPIC_API_KEY — never import this from client code. See index.ts's
 * own note on why fromProse.ts is excluded from the public barrel.
 *
 * src/inference/*.ts's own relative imports must use .ts extensions, same
 * as everything index.ts pulls in — Turbopack bundles this route-handler
 * entrypoint too (server code isn't exempt from its .js->.ts resolution
 * failure) even though it never reaches a client bundle.
 */

export { fromProse } from "./inference/fromProse.ts";
export type { FromProseOptions, FromProseResult } from "./inference/fromProse.ts";
export { explainFix } from "./inference/explainFix.ts";
export type { FixRationale, ExplainFixOptions } from "./inference/explainFix.ts";
export { reworkModel } from "./inference/reworkModel.ts";
export type { ReworkModelOptions, ReworkModelResult, PendingFixInput, PendingChangeInput } from "./inference/reworkModel.ts";
export { identifyFailures } from "./inference/identifyFailures.ts";
export { applyAiFix } from "./inference/applyAiFix.ts";
export type { ApplyAiFixResult } from "./inference/applyAiFix.ts";
export { extractWorkloadParameters } from "./inference/workloadParameters.ts";
export type { WorkloadParameters } from "./inference/workloadParameters.ts";
export {
  proposeExtendedComponents,
  reviseExtendedComponents,
  isExtendedComponent,
  EXTENDED_KINDS,
} from "./inference/extendedComponents.ts";
export type { ExtendedComponentsResponse } from "./inference/extendedComponents.ts";
export { chatWithProject } from "./inference/chatWithProject.ts";
export type { ChatWithProjectResult } from "./inference/chatWithProject.ts";
