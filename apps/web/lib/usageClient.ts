import type { UsageOutcomeReason } from "./usage/outcomes";

/**
 * Client half of AI usage tracking (the server half is lib/usage/). One id
 * per user action, sent with every API call that action makes and stored on
 * the version it produces — see lib/usage/ids.ts for why.
 */
export function newActionId(): string {
  return crypto.randomUUID();
}

/**
 * Tells the server an AI response it billed for was never shown (see
 * app/api/usage/outcome/route.ts). Fire-and-forget: never throws, never
 * awaited, never surfaced — losing a report loses a data point, not a feature.
 */
export function reportOutcome(actionId: string, reason: UsageOutcomeReason): void {
  try {
    void Promise.resolve(
      fetch("/api/usage/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, reason }),
        keepalive: true,
      }),
    ).catch(() => {});
  } catch {
    // ignore
  }
}
