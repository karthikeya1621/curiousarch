/**
 * Client half of the guest trial (server half: lib/trial/). A refused AI action answers with
 * `code: "trial-limit"`; the fetch sites call `notifyTrialLimit` and GuestBanner turns into the
 * sign-in prompt - the diagram stays on screen, nothing is lost.
 */
export const TRIAL_LIMIT_EVENT = "archsim:trial-limit";

export function isTrialLimit(body: unknown): boolean {
  return (body as { code?: unknown } | null)?.code === "trial-limit";
}

export function notifyTrialLimit(body: unknown): void {
  if (isTrialLimit(body) && typeof window !== "undefined") window.dispatchEvent(new Event(TRIAL_LIMIT_EVENT));
}
