import { createHash } from "node:crypto";
import type { TrialKind } from "./limits";

export { TRIAL_LIMITS, NEEDS_BUILD, type TrialKind } from "./limits";

/**
 * The guest trial's rules — pure and env-free, so they are unit-tested. The server half
 * (lib/trial/server.ts) applies them; the SQL (db/guest-trial.sql) makes the count atomic.
 *
 * One trial = 1 build, 1 Re-simulate, 5 chat messages, plus the findings and fix explanations
 * that come with them (each needs a counted build or Re-simulate first, so a guest cannot call
 * them on their own).
 */
export interface TrialConfig {
  /** Master switch. Off unless TRIAL_ENABLED=true, so nothing is exposed before db/guest-trial.sql has been run. */
  enabled: boolean;
  /** Daily (UTC) AI spend by guests after which no NEW guest can start. */
  dailyBudgetUsd: number;
  /** Daily (UTC) AI spend by signed-in free accounts after which no NEW free account can start using the AI. */
  memberDailyBudgetUsd: number;
  /** New guest accounts one (hashed) IP may start per day. */
  maxAccountsPerIp: number;
  /** Ask hCaptcha (via Supabase Auth → Attack Protection) before a guest account is created. */
  captcha: boolean;
}

export function trialConfig(env: Record<string, string | undefined> = process.env): TrialConfig {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    enabled: env.TRIAL_ENABLED === "true",
    dailyBudgetUsd: num(env.TRIAL_DAILY_BUDGET_USD, 2),
    memberDailyBudgetUsd: num(env.TRIAL_MEMBER_DAILY_BUDGET_USD, 10),
    maxAccountsPerIp: Math.floor(num(env.TRIAL_MAX_ACCOUNTS_PER_IP, 3)),
    captcha: env.NEXT_PUBLIC_TRIAL_CAPTCHA === "true",
  };
}

/** What `trial_reserve` returns. */
export type ReserveResult = "ok" | "quota" | "needs-build" | "ip-cap" | "budget";

const QUOTA_LABEL: Record<TrialKind, string> = {
  build: "build",
  rework: "Re-simulate",
  chat: "chat messages",
  findings: "analyses",
  "explain-fix": "fix explanations",
};

/** The HTTP answer for a refused reservation. `code: "trial-limit"` is what the client keys the sign-up prompt on. */
export function refusal(result: Exclude<ReserveResult, "ok">, kind: TrialKind, guest = true): { status: number; body: { error: string; code: "trial-limit"; reason: string } } {
  switch (result) {
    case "quota":
      return { status: 429, body: { error: guest
        ? `You've used your free ${QUOTA_LABEL[kind]} for the trial. Sign in to keep going - your diagram stays as it is.`
        : `You've used your free ${QUOTA_LABEL[kind]}. More will be available with credits - your diagram stays as it is.`, code: "trial-limit", reason: "quota" } };
    case "needs-build":
      return { status: 429, body: { error: "Build a system first, then this is available.", code: "trial-limit", reason: "needs-build" } };
    case "ip-cap":
      return { status: 429, body: { error: "Too many free trials have been started from this network today. Sign in to continue.", code: "trial-limit", reason: "ip-cap" } };
    case "budget":
      return { status: 429, body: { error: guest
        ? "Today's free trials are used up. Sign in to continue."
        : "Today's free usage is used up. Please try again tomorrow.", code: "trial-limit", reason: "budget" } };
  }
}

/** The caller's address as the platform proxy reports it (first hop of x-forwarded-for). */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Only ever a salted hash is stored — never the address. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
