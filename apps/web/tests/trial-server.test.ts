/**
 * The guest gate against a mocked Supabase: signed-in users pass untouched, a guest is refused per
 * the database's answer, an error deciding the quota refuses (never lets a guest through), and a
 * failed attempt is released.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string; is_anonymous?: boolean; email?: string; email_confirmed_at?: string } | null,
  userThrows: false,
  rpcResult: { data: "ok", error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  hasAdmin: true,
}));
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => {
    if (state.userThrows) throw new Error("no request");
    return { auth: { getUser: async () => ({ data: { user: state.user } }) } };
  },
}));
vi.mock("../lib/supabase/admin", () => ({
  getAdminClient: () =>
    state.hasAdmin
      ? {
          rpc: async (fn: string, args: Record<string, unknown>) => {
            state.rpcCalls.push({ fn, args });
            return fn === "trial_reserve" || fn === "trial_budget_open" ? state.rpcResult : { data: null, error: null };
          },
        }
      : null,
}));

const { reserveTrial, guestTrialOpen, refundWithheldRework } = await import("../lib/trial/server");
const ACTION = "11111111-1111-4111-8111-111111111111";
const req = () => new Request("http://x/api/chat", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" } });

beforeEach(() => {
  state.user = { id: "u1", is_anonymous: true };
  state.userThrows = false;
  state.rpcResult = { data: "ok", error: null };
  state.rpcCalls = [];
  state.hasAdmin = true;
  process.env.TRIAL_ENABLED = "true";
  delete process.env.ADMIN_EMAILS;
});

describe("reserveTrial", () => {
  it("limits a signed-in (non-guest) user the same way, as a non-guest", async () => {
    state.user = { id: "u1", is_anonymous: false, email: "a@b.c", email_confirmed_at: "2026-01-01" };
    process.env.ADMIN_EMAILS = "boss@x.y";
    const gate = await reserveTrial(req(), { actionId: ACTION }, "build");
    expect(gate.denied).toBeUndefined();
    expect(state.rpcCalls[0]!.args).toMatchObject({ p_kind: "build", p_limit: 1, p_guest: false });
    state.rpcResult = { data: "quota", error: null };
    const refused = await reserveTrial(req(), { actionId: ACTION }, "build");
    expect((await refused.denied!.json()).error).toContain("credits");
  });

  it("never limits an admin", async () => {
    state.user = { id: "u1", is_anonymous: false, email: "boss@x.y", email_confirmed_at: "2026-01-01" };
    process.env.ADMIN_EMAILS = "boss@x.y";
    const gate = await reserveTrial(req(), { actionId: ACTION }, "build");
    expect(gate.denied).toBeUndefined();
    expect(state.rpcCalls).toEqual([]);
  });

  it("leaves a signed-in user alone when the trial switch is off", async () => {
    state.user = { id: "u1", is_anonymous: false, email: "a@b.c", email_confirmed_at: "2026-01-01" };
    process.env.TRIAL_ENABLED = "false";
    expect((await reserveTrial(req(), {}, "build")).denied).toBeUndefined();
    expect(state.rpcCalls).toEqual([]);
  });

  it("does nothing when the caller cannot be identified (middleware already required a session)", async () => {
    state.userThrows = true;
    expect((await reserveTrial(req(), {}, "build")).denied).toBeUndefined();
  });

  it("reserves with the kind's limit and only a hashed IP", async () => {
    const gate = await reserveTrial(req(), { actionId: ACTION }, "chat");
    expect(gate.denied).toBeUndefined();
    const call = state.rpcCalls[0]!;
    expect(call.fn).toBe("trial_reserve");
    expect(call.args).toMatchObject({ p_user: "u1", p_kind: "chat", p_action: ACTION, p_limit: 5, p_needs_build: false, p_guest: true });
    expect(JSON.stringify(call.args)).not.toContain("9.9.9.9");
  });

  it("flags findings as needing a counted build", async () => {
    await reserveTrial(req(), { actionId: ACTION }, "findings");
    expect(state.rpcCalls[0]!.args.p_needs_build).toBe(true);
  });

  it.each(["quota", "needs-build", "ip-cap", "budget"])("refuses with 429 trial-limit on '%s'", async (result) => {
    state.rpcResult = { data: result, error: null };
    const gate = await reserveTrial(req(), { actionId: ACTION }, "build");
    expect(gate.denied?.status).toBe(429);
    expect((await gate.denied!.json()).code).toBe("trial-limit");
  });

  it("refuses (fails closed) when the quota cannot be decided", async () => {
    state.rpcResult = { data: null, error: { message: "boom" } };
    const gate = await reserveTrial(req(), { actionId: ACTION }, "build");
    expect(gate.denied?.status).toBe(429);
  });

  it("refuses a guest when the trial is off or the service key is missing", async () => {
    process.env.TRIAL_ENABLED = "false";
    expect((await reserveTrial(req(), {}, "build")).denied?.status).toBe(429);
    process.env.TRIAL_ENABLED = "true";
    state.hasAdmin = false;
    expect((await reserveTrial(req(), {}, "build")).denied?.status).toBe(429);
  });

  it("release() gives back only this route's own kind (a failed findings call must not refund the build)", async () => {
    const findings = await reserveTrial(req(), { actionId: ACTION }, "findings");
    await findings.release();
    expect(state.rpcCalls.at(-1)).toEqual({ fn: "trial_release", args: { p_user: "u1", p_action: ACTION, p_kind: "findings" } });
    const rework = await reserveTrial(req(), { actionId: ACTION }, "rework");
    await rework.release();
    expect(state.rpcCalls.at(-1)).toEqual({ fn: "trial_release", args: { p_user: "u1", p_action: ACTION, p_kind: "rework" } });
  });

  it("passes the member budget so signed-in accounts share a daily ceiling", async () => {
    process.env.TRIAL_MEMBER_DAILY_BUDGET_USD = "7";
    await reserveTrial(req(), { actionId: ACTION }, "chat");
    expect(state.rpcCalls[0]!.args.p_member_budget).toBe(7);
    delete process.env.TRIAL_MEMBER_DAILY_BUDGET_USD;
  });

  it("refuses in production when TRIAL_IP_SALT is missing, instead of hashing with a public default", async () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { node: env.NODE_ENV, salt: env.TRIAL_IP_SALT };
    env.NODE_ENV = "production";
    delete env.TRIAL_IP_SALT;
    const refused = await reserveTrial(req(), { actionId: ACTION }, "chat");
    expect(refused.denied?.status).toBe(429);
    expect(state.rpcCalls).toEqual([]);
    env.TRIAL_IP_SALT = "a-long-random-salt";
    expect((await reserveTrial(req(), { actionId: ACTION }, "chat")).denied).toBeUndefined();
    env.NODE_ENV = before.node;
    if (before.salt === undefined) delete env.TRIAL_IP_SALT;
    else env.TRIAL_IP_SALT = before.salt;
  });
});

describe("refundWithheldRework", () => {
  it("asks the database for a capped refund of that Re-simulate only", async () => {
    await refundWithheldRework("u1", ACTION);
    expect(state.rpcCalls.at(-1)).toEqual({ fn: "trial_refund", args: { p_user: "u1", p_action: ACTION } });
  });
});

describe("guestTrialOpen", () => {
  it("is closed when off, when the budget is spent, and when the check fails", async () => {
    process.env.TRIAL_ENABLED = "false";
    expect(await guestTrialOpen()).toBe(false);
    process.env.TRIAL_ENABLED = "true";
    state.rpcResult = { data: false, error: null };
    expect(await guestTrialOpen()).toBe(false);
    state.rpcResult = { data: null, error: { message: "x" } };
    expect(await guestTrialOpen()).toBe(false);
  });
  it("is open while the budget lasts, and asks with the configured budget", async () => {
    process.env.TRIAL_DAILY_BUDGET_USD = "2";
    state.rpcResult = { data: true, error: null };
    expect(await guestTrialOpen()).toBe(true);
    expect(state.rpcCalls.at(-1)).toEqual({ fn: "trial_budget_open", args: { p_budget: 2 } });
  });
});
