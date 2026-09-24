/**
 * The /admin/usage page: authorization comes before data. Its own file
 * because it mocks `loadDashboard`, which admin-usage.test.ts tests for real.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// next/link needs the app router mounted; a plain anchor is all this test needs.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const RAW = { days: 30, totals: {} } as never;

const requireAdminMock = vi.fn();
const getAdminClientMock = vi.fn();
const loadDashboardMock = vi.fn();
vi.mock("../lib/admin", async (orig) => ({ ...(await orig<typeof import("../lib/admin")>()), requireAdmin: () => requireAdminMock() }));
vi.mock("../lib/supabase/admin", () => ({ getAdminClient: () => getAdminClientMock() }));
vi.mock("../lib/usage/dashboard", async (orig) => ({
  ...(await orig<typeof import("../lib/usage/dashboard")>()),
  loadDashboard: (...args: unknown[]) => loadDashboardMock(...args),
}));

describe("/admin/usage page", () => {
  const render = async (query: Record<string, string> = {}) => {
    const { default: Page } = await import("../app/admin/usage/page");
    return Page({ searchParams: Promise.resolve(query) } as never);
  };

  beforeEach(() => {
    requireAdminMock.mockReset();
    getAdminClientMock.mockReset().mockReturnValue({ fake: "admin" });
    loadDashboardMock.mockReset().mockResolvedValue({ raw: RAW, emails: {}, projectNames: {} });
  });

  it("never reads a single row for someone who isn't an admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getAdminClientMock).not.toHaveBeenCalled();
    expect(loadDashboardMock).not.toHaveBeenCalled();
  });

  it("loads the requested window for an admin, defaulting to 30 days", async () => {
    requireAdminMock.mockResolvedValue({ id: "me" });
    await render({ days: "7" });
    expect(loadDashboardMock).toHaveBeenLastCalledWith({ fake: "admin" }, 7);
    await render({ days: "junk" });
    expect(loadDashboardMock).toHaveBeenLastCalledWith({ fake: "admin" }, 30);
  });

  it("renders a setup message instead of failing when the service key or SQL is missing", async () => {
    requireAdminMock.mockResolvedValue({ id: "me" });
    getAdminClientMock.mockReturnValue(null);
    await expect(render()).resolves.toBeDefined();
    expect(loadDashboardMock).not.toHaveBeenCalled();

    getAdminClientMock.mockReturnValue({ fake: "admin" });
    loadDashboardMock.mockRejectedValue(new Error("re-run the SQL"));
    await expect(render()).resolves.toBeDefined();
  });

  it("renders real-shaped data: totals, the unpriced warning, names instead of ids, and the paid-but-never-shown rows", async () => {
    requireAdminMock.mockResolvedValue({ id: "me" });
    loadDashboardMock.mockResolvedValue({
      raw: {
        days: 7,
        totals: {
          cost_usd: 0.0123, calls: 40, actions: 10, users: 2, input_tokens: 9000, output_tokens: 4000,
          cache_read_input_tokens: 3000, cache_creation_input_tokens: 1000, cache_savings_usd: 0.004, retry_calls: 8,
          failed_cost_usd: 0.0041,
          failed_calls: 5, truncated_calls: 1, unpriced_calls: 12, avg_ms: 2400, wasted_actions: 2, wasted_cost_usd: 0.0031,
        },
        daily: [{ day: new Date().toISOString().slice(0, 10), cost_usd: 0.0123, wasted_usd: 0.0041, calls: 40 }],
        by_action: [{ action: "rework", actions: 4, calls: 12, cost_usd: 0.01, avg_cost_usd: 0.0025, avg_ms: 9000, retries: 2 }],
        by_label: [
          { label: "reworkModel", model: "claude-sonnet-5", calls: 12, cost_usd: null, wasted_usd: 0.0041, retry_pct: 25, failed_pct: 8.3, truncated_pct: 0, cache_hit_pct: 60, avg_ms: 8000, avg_output_tokens: 900 },
        ],
        top_users: [{ user_id: "11111111-aaaa", actions: 6, calls: 30, cost_usd: 0.01 }],
        top_projects: [{ project_id: "22222222-bbbb", user_id: "11111111-aaaa", actions: 3, calls: 12, cost_usd: 0.008 }],
        top_actions: [
          { action_id: "33333333-cccc-4ccc-8ccc-cccccccccccc", user_id: "11111111-aaaa", project_id: "22222222-bbbb", action: "rework", started_at: "2026-09-22T10:00:00Z", calls: 3, retries: 1, failed_attempts: 1, cost_usd: 0.004, cost_complete: false, total_ms: 9400, discarded_reasons: ["superseded"] },
        ],
        wasted: [{ reason: "superseded", actions: 2, cost_usd: 0.0031 }],
        recent_failures: [{ created_at: "2026-09-22T10:00:00Z", label: "reworkModel", model: "claude-sonnet-5", outcome: "invalid", attempt: 0, action: "rework", error: "edges: Required", stop_reason: "tool_use" }],
      },
      emails: { "11111111-aaaa": "someone@example.com" },
      projectNames: { "22222222-bbbb": "Movie booking" },
    });

    const html = renderToStaticMarkup(await (await import("../app/admin/usage/page")).default({ searchParams: Promise.resolve({ days: "7" }) } as never));

    expect(html).toContain("$0.012"); // total cost
    expect(html).toContain("12 calls have no price configured");
    // The retry bill: a KPI with its share of spend, a legend, and a per-step column.
    expect(html).toContain("Wasted on failed attempts");
    expect(html).toContain("$0.0041");
    expect(html).toContain("33.3% of spend"); // 0.0041 / 0.0123
    expect(html).toContain("5 of 40 attempts failed");
    expect(html).toContain("wasted on failed attempts</span>"); // chart legend
    expect(html).toMatch(/height:33\.3\d*%/); // the wasted segment: 0.0041 of that day's 0.0123, inside its bar
    expect(html).toContain(">Wasted<"); // by-step column header
    expect(html).toContain("claude-sonnet-5");
    expect(html).toContain("someone@example.com"); // the name, not the id
    expect(html).toContain("Movie booking");
    expect(html).toContain("superseded");
    expect(html).toContain("edges: Required");
    expect(html).toContain("$0.0040+"); // "+" = some calls in that action are unpriced
    expect(html).toContain("unpriced"); // the step whose model has no price
    expect(html).toContain('href="/admin/usage?days=30"'); // range switcher
    expect(html).toContain('aria-current="page"'); // current range marked
  });
});
