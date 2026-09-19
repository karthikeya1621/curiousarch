/**
 * Client-and-server-shared input guardrails — a longer, denser
 * description tends to produce a bigger (and correspondingly more
 * expensive to generate and re-generate) model, on top of the engine's
 * own MAX_BASE_COMPONENTS/MAX_TOTAL_COMPONENTS caps (packages/engine/src/
 * types.ts). This one lives here, not there, since it's about the input
 * side (what the user types) rather than the model the AI produces.
 * Enforced in both `ProseInput.tsx` (so a user sees the limit before
 * hitting it) and `/api/infer/route.ts` (so it holds even for a request
 * that skips the UI entirely) — the same number, not two.
 */
export const MAX_DESCRIPTION_LENGTH = 1500;
