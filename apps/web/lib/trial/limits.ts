/**
 * Client-safe half of the guest trial's rules (no node imports); policy.ts has the rest.
 *
 * One trial = 1 build, 1 Re-simulate, 5 chat messages, plus the findings and fix explanations that
 * come with them (each needs a counted build or Re-simulate first, so a guest cannot call them alone).
 */
export const TRIAL_LIMITS = { build: 1, rework: 1, chat: 5, findings: 3, "explain-fix": 3 } as const;
export type TrialKind = keyof typeof TRIAL_LIMITS;

/** Actions that only make sense on top of a counted build/Re-simulate. */
export const NEEDS_BUILD: readonly TrialKind[] = ["findings", "explain-fix"];
