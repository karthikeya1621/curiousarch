/**
 * Why an AI response was paid for but never shown — reported by the client
 * (see lib/usageClient.ts, app/api/usage/outcome/route.ts).
 *  - project-switched: the user opened or started another project while it was in flight.
 *  - superseded: a newer request for the same thing landed first (its findings are still
 *    kept as a version, but never displayed).
 *  - withheld: a Re-simulate result discarded because the model or queue changed during the run.
 */
export const USAGE_OUTCOME_REASONS = ["project-switched", "superseded", "withheld"] as const;
export type UsageOutcomeReason = (typeof USAGE_OUTCOME_REASONS)[number];
