import type { SupabaseClient } from "@supabase/supabase-js";

/** The shape returned by `ai_admin_dashboard()` in db/ai-usage.sql. */
export interface DashboardRaw {
  days: number;
  totals: {
    cost_usd: number;
    calls: number;
    actions: number;
    users: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    cache_savings_usd: number;
    retry_calls: number;
    failed_calls: number;
    truncated_calls: number;
    unpriced_calls: number;
    avg_ms: number;
    wasted_actions: number;
    wasted_cost_usd: number;
  };
  daily: { day: string; cost_usd: number | null; calls: number }[];
  by_action: {
    action: string;
    actions: number;
    calls: number;
    cost_usd: number;
    avg_cost_usd: number | null;
    avg_ms: number | null;
    retries: number;
  }[];
  by_label: {
    label: string;
    model: string;
    calls: number;
    cost_usd: number | null;
    retry_pct: number;
    failed_pct: number;
    truncated_pct: number;
    cache_hit_pct: number | null;
    avg_ms: number;
    avg_output_tokens: number;
  }[];
  top_users: { user_id: string; actions: number; calls: number; cost_usd: number }[];
  top_projects: { project_id: string; user_id: string; actions: number; calls: number; cost_usd: number }[];
  top_actions: {
    action_id: string;
    user_id: string;
    project_id: string | null;
    action: string;
    started_at: string;
    calls: number;
    retries: number;
    failed_attempts: number;
    cost_usd: number | null;
    cost_complete: boolean;
    total_ms: number;
    discarded_reasons: string[] | null;
  }[];
  wasted: { reason: string; actions: number; cost_usd: number }[];
  recent_failures: {
    created_at: string;
    label: string;
    model: string;
    outcome: string;
    attempt: number;
    action: string;
    error: string | null;
    stop_reason: string | null;
  }[];
}

export interface Dashboard {
  raw: DashboardRaw;
  /** user id → email, for the users that appear in the top lists. */
  emails: Record<string, string>;
  /** project id → name, for the projects that appear in the top lists (a deleted project has none). */
  projectNames: Record<string, string>;
}

export const DASHBOARD_RANGES = [1, 7, 30, 90] as const;

/** `?days=` from the URL → a supported window; anything else falls back to 30. */
export function parseRange(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? n : 30;
}

/**
 * Everything the page shows: the SQL rollup in one round trip, then the
 * human-readable names for the ids in the top lists (an id alone tells you
 * nothing). Takes the service-role client as an argument so it can be tested
 * without a database. Throws with a readable message when the function isn't
 * installed yet, which is the one setup step people forget.
 */
export async function loadDashboard(admin: SupabaseClient, days: number): Promise<Dashboard> {
  const { data, error } = await admin.rpc("ai_admin_dashboard", { p_days: days });
  if (error || !data) {
    // Two different failures land here, and the fix for one does nothing for
    // the other — telling them apart matters. Postgres reports a missing
    // function/table as `42883`/`42P01` ("does not exist"), which really
    // does mean "go run the SQL." Anything else — most commonly Supabase's
    // own "Invalid API key" — means SUPABASE_SERVICE_ROLE_KEY itself is
    // wrong (or was rotated), and re-running the SQL fixes nothing.
    const code = (error as { code?: string } | undefined)?.code;
    const isMissingSchema = code === "42883" || code === "42P01" || /does not exist/i.test(error?.message ?? "");
    const hint = isMissingSchema
      ? "Re-run apps/web/db/ai-usage.sql in the Supabase SQL editor."
      : "Check SUPABASE_SERVICE_ROLE_KEY in .env.local — this looks like an authentication failure, not a missing-SQL one (Supabase may have rotated the key, or it's from a different project than NEXT_PUBLIC_SUPABASE_URL).";
    throw new Error(`ai_admin_dashboard failed${error ? `: ${error.message}` : ""}. ${hint}`);
  }
  const raw = data as DashboardRaw;

  const userIds = [
    ...new Set([
      ...raw.top_users.map((u) => u.user_id),
      ...raw.top_projects.map((p) => p.user_id),
      ...raw.top_actions.map((a) => a.user_id),
    ]),
  ];
  const projectIds = [
    ...new Set([
      ...raw.top_projects.map((p) => p.project_id),
      ...raw.top_actions.map((a) => a.project_id).filter((id): id is string => id !== null),
    ]),
  ];

  const emails: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data: res } = await admin.auth.admin.getUserById(id);
        if (res?.user?.email) emails[id] = res.user.email;
      } catch {
        // A user who no longer exists just shows as their id.
      }
    }),
  );

  const projectNames: Record<string, string> = {};
  if (projectIds.length > 0) {
    try {
      const { data: rows } = await admin.from("projects").select("id, name").in("id", projectIds);
      for (const row of (rows ?? []) as { id: string; name: string }[]) projectNames[row.id] = row.name;
    } catch {
      // Names are a nicety; the ids still identify the rows.
    }
  }

  return { raw, emails, projectNames };
}
