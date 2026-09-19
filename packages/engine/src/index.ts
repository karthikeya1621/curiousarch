/**
 * Public entrypoint. Consumers (apps/web) import from here, not from
 * individual files — this is the contract PLAN-1.2 establishes.
 *
 * Deliberately excludes src/inference/* (schema.ts, fromProse.ts, prompt.ts):
 * fromProse.ts pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY, which
 * must stay server-side. Nothing here should end up in a client bundle.
 *
 * Every relative import here (and in every file it transitively pulls in —
 * components.ts) uses an explicit .ts extension, not .js. Confirmed live:
 * Turbopack cannot resolve a .js-suffixed specifier pointing at a .ts file
 * for this workspace package at all — same-directory or cross-directory, it
 * doesn't matter, and a type-only import (which TypeScript elides entirely
 * at runtime) will look like it works and prove nothing. tsc/tsx/vitest
 * accept .ts extensions fine under moduleResolution: "bundler", so this is
 * safe everywhere. Files only reached via tsx/vitest (tests/) are
 * unaffected by this and were deliberately left on .js — no reason to
 * touch what already works.
 */

export * from "./types.ts";
export { isAsyncBoundary } from "./components.ts";
export * from "../models/reference.ts";
