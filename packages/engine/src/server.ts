/**
 * Server-only entrypoint. Pulls in @anthropic-ai/sdk and reads
 * ANTHROPIC_API_KEY — never import this from client code. See index.ts's
 * own note on why fromProse.ts is excluded from the public barrel.
 */

export { fromProse } from "./inference/fromProse.ts";
export type { FromProseOptions, FromProseResult } from "./inference/fromProse.ts";
