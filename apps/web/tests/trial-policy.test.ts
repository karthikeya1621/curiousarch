/**
 * The guest trial's pure rules: limits, config parsing, refusal answers, IP hashing.
 */
import { describe, expect, it } from "vitest";
import { TRIAL_LIMITS, NEEDS_BUILD, clientIp, hashIp, refusal, trialConfig } from "../lib/trial/policy";

describe("trial limits", () => {
  it("is 1 build, 1 Re-simulate and 5 chat messages", () => {
    expect(TRIAL_LIMITS.build).toBe(1);
    expect(TRIAL_LIMITS.rework).toBe(1);
    expect(TRIAL_LIMITS.chat).toBe(5);
  });
  it("makes findings and fix explanations depend on a counted build or Re-simulate", () => {
    expect(NEEDS_BUILD).toEqual(["findings", "explain-fix"]);
  });
});

describe("trialConfig", () => {
  it("is off by default, with a $2 budget and 3 accounts per IP", () => {
    expect(trialConfig({})).toEqual({ enabled: false, dailyBudgetUsd: 2, memberDailyBudgetUsd: 10, maxAccountsPerIp: 3, captcha: false });
  });
  it("reads the switches", () => {
    expect(
      trialConfig({ TRIAL_ENABLED: "true", TRIAL_DAILY_BUDGET_USD: "5.5", TRIAL_MEMBER_DAILY_BUDGET_USD: "20", TRIAL_MAX_ACCOUNTS_PER_IP: "1", NEXT_PUBLIC_TRIAL_CAPTCHA: "true" }),
    ).toEqual({
      enabled: true,
      dailyBudgetUsd: 5.5,
      memberDailyBudgetUsd: 20,
      maxAccountsPerIp: 1,
      captcha: true,
    });
  });
  it("only treats the exact string 'true' as on, and ignores junk numbers", () => {
    const c = trialConfig({ TRIAL_ENABLED: "1", TRIAL_DAILY_BUDGET_USD: "abc", TRIAL_MAX_ACCOUNTS_PER_IP: "-2" });
    expect(c.enabled).toBe(false);
    expect(c.dailyBudgetUsd).toBe(2);
    expect(c.maxAccountsPerIp).toBe(3);
  });
});

describe("refusal", () => {
  it("answers 429 with the code the client keys the sign-up prompt on", () => {
    for (const r of ["quota", "needs-build", "ip-cap", "budget"] as const) {
      const { status, body } = refusal(r, "chat");
      expect(status).toBe(429);
      expect(body.code).toBe("trial-limit");
      expect(body.reason).toBe(r);
    }
  });
  it("names what was used up", () => {
    expect(refusal("quota", "rework").body.error).toContain("Re-simulate");
  });
  it("tells a signed-in user to come back tomorrow, not to sign in, when the daily budget is spent", () => {
    expect(refusal("budget", "build", true).body.error).toContain("Sign in");
    const member = refusal("budget", "build", false).body.error;
    expect(member).not.toContain("Sign in");
    expect(member).toContain("tomorrow");
  });
});

describe("ip handling", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
  it("stores only a salted hash, never the address", () => {
    const h = hashIp("1.2.3.4", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("1.2.3.4");
    expect(hashIp("1.2.3.4", "salt")).toBe(h);
    expect(hashIp("1.2.3.4", "other")).not.toBe(h);
    expect(hashIp("1.2.3.5", "salt")).not.toBe(h);
  });
});
