import { NextResponse } from "next/server";
import { createClient } from "../supabase/server";
import { getAdminClient } from "../supabase/admin";
import { readUsageIds } from "../usage/ids";
import { isAdminUser } from "../admin";
import { clientIp, hashIp, refusal, trialConfig, NEEDS_BUILD, TRIAL_LIMITS, type ReserveResult, type TrialKind } from "./policy";

/**
 * What a route holds while it runs a guest's AI action. `denied` is the response to return instead of
 * running it; otherwise run the action and, if it fails, `release()` so a failed attempt is not counted.
 * For a signed-in (non-guest) user, and whenever the trial is off, this is a no-op.
 */
export interface TrialGate {
  denied?: NextResponse;
  release: () => Promise<void>;
}

const noop: TrialGate = { release: async () => {} };

/**
 * Enforced on the server before any engine call: the client is never trusted with the count. Fails
 * closed for a guest (an error deciding the quota refuses the action) and open only where it cannot
 * tell whether the caller is a guest at all - middleware has already required a session by then.
 */
export async function reserveTrial(request: Request, body: unknown, kind: TrialKind): Promise<TrialGate> {
  let userId: string;
  let guest: boolean;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Admins are never limited. Everyone else gets the same quota until credits exist; guests are
    // additionally held to the daily budget and per-IP cap (see trial_reserve).
    if (!user || isAdminUser(user)) return noop;
    userId = user.id;
    guest = Boolean(user.is_anonymous);
  } catch {
    return noop;
  }

  const config = trialConfig();
  const unavailable = (): TrialGate => ({
    denied: NextResponse.json({ error: "The free trial isn't available right now. Please sign in.", code: "trial-limit", reason: "unavailable" }, { status: 429 }),
    release: async () => {},
  });
  const admin = getAdminClient();
  // With the trial switched off a signed-in user is unaffected; a guest has no access at all.
  if (!config.enabled && !guest) return noop;
  if (!config.enabled || !admin) return unavailable();

  const { actionId } = readUsageIds(body);
  try {
    const { data, error } = await admin.rpc("trial_reserve", {
      p_user: userId,
      p_ip_hash: hashIp(clientIp(request.headers), process.env.TRIAL_IP_SALT ?? "archsim-trial"),
      p_kind: kind,
      p_action: actionId,
      p_limit: TRIAL_LIMITS[kind],
      p_ip_cap: config.maxAccountsPerIp,
      p_budget: config.dailyBudgetUsd,
      p_needs_build: NEEDS_BUILD.includes(kind),
      p_guest: guest,
    });
    if (error) throw new Error(error.message);
    const result = data as ReserveResult;
    if (result !== "ok") {
      const { status, body: payload } = refusal(result, kind, guest);
      return { denied: NextResponse.json(payload, { status }), release: async () => {} };
    }
  } catch (err) {
    console.error("[trial] could not check the quota:", err);
    return unavailable();
  }

  return {
    release: async () => {
      try {
        await admin.rpc("trial_release", { p_user: userId, p_action: actionId });
      } catch (err) {
        console.error("[trial] could not release a failed attempt:", err);
      }
    },
  };
}

/** Gives back whatever the guest's action `actionId` held (a Re-simulate result the client threw away). No-op for anyone else. */
export async function releaseTrialAction(userId: string, actionId: string): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  try {
    await admin.rpc("trial_release", { p_user: userId, p_action: actionId });
  } catch (err) {
    console.error("[trial] could not release a withheld attempt:", err);
  }
}

/** Is the guest option open for new visitors right now? Never throws. */
export async function guestTrialOpen(): Promise<boolean> {
  const config = trialConfig();
  if (!config.enabled) return false;
  const admin = getAdminClient();
  if (!admin) return false;
  try {
    const { data, error } = await admin.rpc("trial_budget_open", { p_budget: config.dailyBudgetUsd });
    return !error && data === true;
  } catch {
    return false;
  }
}
