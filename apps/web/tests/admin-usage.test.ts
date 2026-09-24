/**
 * The admin cost dashboard: who's allowed in (fail closed), the data loader,
 * the formatting helpers, and that the page checks authorization BEFORE it
 * touches any data.
 */

import { describe, expect, it, vi } from "vitest";
import { isAdminUser, parseAdminEmails } from "../lib/admin";
import { fillDays, formatInt, formatMs, formatPct, formatUsd, ratioPct } from "../lib/usage/format";
import { loadDashboard, parseRange, type DashboardRaw } from "../lib/usage/dashboard";

describe("admin allow-list", () => {
  it("parses ADMIN_EMAILS: trimmed, lower-cased, blanks dropped — and NOBODY when unset", () => {
    expect(parseAdminEmails(" Me@Example.com , ,you@x.io")).toEqual(["me@example.com", "you@x.io"]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual(parseAdminEmails(process.env.ADMIN_EMAILS));
  });

  const confirmed = "2026-01-01T00:00:00Z";
  it("admits a listed, CONFIRMED email, case-insensitively", () => {
    expect(isAdminUser({ email: "ME@example.com", email_confirmed_at: confirmed }, ["me@example.com"])).toBe(true);
  });

  it.each([
    ["an unlisted email", { email: "other@example.com", email_confirmed_at: confirmed }],
    ["a listed but UNCONFIRMED email — just a typed string", { email: "me@example.com", email_confirmed_at: undefined }],
    ["no email at all", { email: undefined, email_confirmed_at: confirmed }],
    ["nobody signed in", null],
  ])("refuses %s", (_label, user) => {
    expect(isAdminUser(user as never, ["me@example.com"])).toBe(false);
  });

  it("refuses everyone when no admins are configured", () => {
    expect(isAdminUser({ email: "me@example.com", email_confirmed_at: confirmed }, [])).toBe(false);
  });
});

describe("formatting", () => {
  it("scales cost precision — sub-cent costs stay visible", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00234)).toBe("$0.0023");
    expect(formatUsd(0.0234)).toBe("$0.023");
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(1234.5)).toBe("$1235");
    expect(formatUsd(null)).toBe("—");
  });

  it("formats counts, percentages, durations and ratios, with a dash for missing values", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(undefined)).toBe("—");
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(null)).toBe("—");
    expect(formatMs(450)).toBe("450ms");
    expect(formatMs(4250)).toBe("4.3s");
    expect(ratioPct(1, 4)).toBe(25);
    expect(ratioPct(1, 0)).toBeNull();
  });

  it("carries each day's wasted spend through the zero-fill — and treats a missing value (an older database function) as none", () => {
    const filled = fillDays(
      [
        { day: "2026-09-21", cost_usd: 0.5, wasted_usd: 0.2, calls: 3 },
        { day: "2026-09-22", cost_usd: 0.1, calls: 1 }, // predates the wasted column
      ],
      3,
      new Date("2026-09-22T10:00:00Z"),
    );
    expect(filled.map((d) => d.wasted_usd)).toEqual([0, 0.2, 0]);
  });

  it("zero-fills the chart so quiet days show as quiet, oldest first, ending today", () => {
    const filled = fillDays([{ day: "2026-09-21", cost_usd: 0.5, calls: 3 }], 3, new Date("2026-09-22T10:00:00Z"));
    expect(filled).toEqual([
      { day: "2026-09-20", cost_usd: 0, wasted_usd: 0, calls: 0 },
      { day: "2026-09-21", cost_usd: 0.5, wasted_usd: 0, calls: 3 },
      { day: "2026-09-22", cost_usd: 0, wasted_usd: 0, calls: 0 },
    ]);
  });
});

describe("parseRange", () => {
  it("accepts the offered windows and falls back to 30 for anything else", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("1")).toBe(1);
    expect(parseRange(["90"])).toBe(90);
    expect(parseRange("365")).toBe(30);
    expect(parseRange("abc")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });
});

const RAW: DashboardRaw = {
  days: 30,
  totals: {
    cost_usd: 1, calls: 4, actions: 2, users: 2, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, cache_savings_usd: 0, retry_calls: 1, failed_calls: 1, truncated_calls: 0,
    unpriced_calls: 0, avg_ms: 1, wasted_actions: 0, wasted_cost_usd: 0,
  },
  daily: [],
  by_action: [],
  by_label: [],
  top_users: [{ user_id: "u1", actions: 1, calls: 2, cost_usd: 1 }],
  top_projects: [{ project_id: "p1", user_id: "u1", actions: 1, calls: 2, cost_usd: 1 }],
  top_actions: [
    {
      action_id: "a1", user_id: "u2", project_id: "p2", action: "rework", started_at: "2026-09-22T00:00:00Z",
      calls: 2, retries: 0, failed_attempts: 0, cost_usd: 1, cost_complete: true, total_ms: 1, discarded_reasons: null,
    },
  ],
  wasted: [],
  recent_failures: [],
};

function fakeAdmin(opts: { rpc?: { data: unknown; error: { message: string; code?: string } | null }; getUser?: (id: string) => Promise<unknown> } = {}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpc ?? { data: RAW, error: null });
  const inFn = vi.fn().mockResolvedValue({ data: [{ id: "p1", name: "Checkout" }], error: null });
  const from = vi.fn(() => ({ select: () => ({ in: inFn }) }));
  const getUserById = vi.fn(opts.getUser ?? (async (id: string) => ({ data: { user: { email: `${id}@example.com` } } })));
  return { client: { rpc, from, auth: { admin: { getUserById } } } as never, rpc, from, inFn, getUserById };
}

describe("loadDashboard", () => {
  it("asks the database function for the window, then names the users and projects in the top lists — each looked up once", async () => {
    const admin = fakeAdmin();
    const result = await loadDashboard(admin.client, 7);

    expect(admin.rpc).toHaveBeenCalledWith("ai_admin_dashboard", { p_days: 7 });
    expect(result.raw).toBe(RAW);
    expect(result.emails).toEqual({ u1: "u1@example.com", u2: "u2@example.com" });
    expect(admin.getUserById).toHaveBeenCalledTimes(2); // u1 appears in two lists, looked up once
    expect(admin.inFn).toHaveBeenCalledWith("id", expect.arrayContaining(["p1", "p2"]));
    expect(result.projectNames).toEqual({ p1: "Checkout" });
  });

  it("tolerates a user or project that can't be resolved — the row just shows its id", async () => {
    const admin = fakeAdmin({
      getUser: async (id) => {
        if (id === "u1") throw new Error("gone");
        return { data: { user: null } };
      },
    });
    const result = await loadDashboard(admin.client, 30);
    expect(result.emails).toEqual({});
    expect(result.raw.top_users).toHaveLength(1);
  });

  it("says to re-run the SQL when the function isn't installed", async () => {
    const admin = fakeAdmin({
      rpc: { data: null, error: { message: "function ai_admin_dashboard(p_days) does not exist", code: "42883" } },
    });
    await expect(loadDashboard(admin.client, 30)).rejects.toThrow(/does not exist[\s\S]*ai-usage\.sql/);
  });

  it("points at the service-role key instead — not the SQL — for anything that isn't a missing-schema error", async () => {
    const admin = fakeAdmin({ rpc: { data: null, error: { message: "Invalid API key" } } });
    await expect(loadDashboard(admin.client, 30)).rejects.toThrow(/Invalid API key[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
    await expect(loadDashboard(admin.client, 30)).rejects.not.toThrow(/ai-usage\.sql/);
  });
});
