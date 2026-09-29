import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "../../../components/Card";
import { requireAdmin } from "../../../lib/admin";
import { getAdminClient } from "../../../lib/supabase/admin";
import { DASHBOARD_RANGES, loadDashboard, parseRange, type Dashboard } from "../../../lib/usage/dashboard";
import { fillDays, formatInt, formatMs, formatPct, formatUsd, ratioPct } from "../../../lib/usage/format";

export const metadata: Metadata = { title: "AI usage · CuriousArch", robots: { index: false, follow: false } };

/**
 * Operator-only cost dashboard: everything `ai_calls` records, across all
 * users. Server-rendered on every request (it reads the session cookie), and
 * gated by `requireAdmin()` BEFORE any data is fetched — anyone else gets a
 * 404. The numbers come from one SQL function (db/ai-usage.sql), so nothing
 * here aggregates in JS beyond zero-filling the chart's empty days.
 */
export default async function UsagePage({ searchParams }: PageProps<"/admin/usage">) {
  await requireAdmin();
  const days = parseRange((await searchParams).days);

  const admin = getAdminClient();
  let dashboard: Dashboard | null = null;
  let problem: string | null = null;
  if (!admin) {
    problem = "SUPABASE_SERVICE_ROLE_KEY isn't set, so usage isn't being recorded or read. Add it to .env.local and restart.";
  } else {
    try {
      dashboard = await loadDashboard(admin, days);
    } catch (err) {
      problem = err instanceof Error ? err.message : "Couldn't load usage.";
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">AI usage</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every AI call, all users · last {days === 1 ? "24 hours" : `${days} days`} (UTC)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <nav aria-label="Time range" className="flex overflow-hidden rounded-lg border border-slate-200 text-sm dark:border-slate-700">
            {DASHBOARD_RANGES.map((r) => (
              <Link
                key={r}
                href={`/admin/usage?days=${r}`}
                aria-current={r === days ? "page" : undefined}
                className={
                  "px-3 py-1.5 " +
                  (r === days
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700")
                }
              >
                {r === 1 ? "24h" : `${r}d`}
              </Link>
            ))}
          </nav>
          <Link href="/" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            ← Back to app
          </Link>
        </div>
      </header>

      {problem && (
        <Card>
          <p className="text-sm text-rose-600 dark:text-rose-400">{problem}</p>
        </Card>
      )}
      {dashboard && <DashboardView dashboard={dashboard} days={days} />}
    </main>
  );
}

function DashboardView({ dashboard, days }: { dashboard: Dashboard; days: number }) {
  const { raw, emails, projectNames } = dashboard;
  const t = raw.totals;
  const who = (id: string) => emails[id] ?? `${id.slice(0, 8)}…`;
  const project = (id: string | null) => (id === null ? "—" : (projectNames[id] ?? `${id.slice(0, 8)}…`));
  const daily = fillDays(raw.daily, days === 1 ? 2 : days);
  const maxDaily = Math.max(...daily.map((d) => d.cost_usd), 0);

  return (
    <>
      {t.unpriced_calls > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/60">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">{formatInt(t.unpriced_calls)} calls have no price configured</span>, so the
            cost totals below understate real spend. Set <code>AI_MODEL_PRICES</code> for{" "}
            {[...new Set(raw.by_label.filter((l) => l.cost_usd === null).map((l) => l.model))].join(", ") || "those models"}{" "}
            — tokens are stored, so past rows can be backfilled (see the end of db/ai-usage.sql).
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total cost" value={formatUsd(t.cost_usd)} hint={`${formatInt(t.calls)} calls`} />
        <Kpi
          label="Per action"
          value={formatUsd(t.actions > 0 ? t.cost_usd / t.actions : null)}
          hint={`${formatInt(t.actions)} actions (builds, re-simulates, chats…)`}
        />
        <Kpi label="Active users" value={formatInt(t.users)} hint={`${formatUsd(t.users > 0 ? t.cost_usd / t.users : null)} each`} />
        <Kpi label="Cache savings" value={formatUsd(t.cache_savings_usd)} hint={`${formatPct(ratioPct(t.cache_read_input_tokens, t.input_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens), 0)} of input tokens from cache`} />
        <Kpi label="Retries" value={formatPct(ratioPct(t.retry_calls, t.calls))} hint={`${formatInt(t.retry_calls)} repair calls`} tone={t.retry_calls / Math.max(t.calls, 1) > 0.15 ? "warn" : undefined} />
        <Kpi
          label="Wasted on failed attempts"
          value={t.failed_cost_usd === undefined ? "—" : formatUsd(t.failed_cost_usd)}
          hint={
            t.failed_cost_usd === undefined
              ? "re-run db/ai-usage.sql to enable"
              : `${formatPct(ratioPct(t.failed_cost_usd, t.cost_usd))} of spend · ${formatInt(t.failed_calls)} of ${formatInt(t.calls)} attempts failed`
          }
          tone={t.failed_calls > 0 ? "warn" : undefined}
        />
        <Kpi label="Truncated" value={formatInt(t.truncated_calls)} hint="hit the output-token ceiling" tone={t.truncated_calls > 0 ? "warn" : undefined} />
        <Kpi label="Paid, never shown" value={formatUsd(t.wasted_cost_usd)} hint={`${formatInt(t.wasted_actions)} actions`} tone={t.wasted_actions > 0 ? "warn" : undefined} />
      </section>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cost per day</h2>
          <p className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-cyan-500 dark:bg-cyan-400" /> total
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-500" /> wasted on failed attempts
            </span>
          </p>
        </div>
        <div className="mt-3 flex h-36 items-end gap-px" role="img" aria-label="Daily cost, with the share wasted on failed attempts">
          {daily.map((d) => {
            const barPct = maxDaily > 0 ? Math.max((d.cost_usd / maxDaily) * 100, d.cost_usd > 0 ? 2 : 0) : 0;
            // The wasted share sits INSIDE its day's bar (bottom-anchored), so
            // a bar that's mostly amber reads at a glance as "mostly retries".
            const wastedPct = d.cost_usd > 0 ? Math.min((d.wasted_usd / d.cost_usd) * 100, 100) : 0;
            return (
              <div
                key={d.day}
                title={`${d.day}: ${formatUsd(d.cost_usd)} · ${formatUsd(d.wasted_usd)} wasted · ${formatInt(d.calls)} calls`}
                className="flex h-full min-w-0 flex-1 items-end"
              >
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-cyan-500 dark:bg-cyan-400"
                  style={{ height: `${barPct}%` }}
                >
                  {d.wasted_usd > 0 && <div className="w-full bg-amber-500" style={{ height: `${wastedPct}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>{daily[0]?.day}</span>
          <span>peak {formatUsd(maxDaily)}</span>
          <span>{daily.at(-1)?.day}</span>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By action" note="What one user action costs end to end">
          <Table
            rows={raw.by_action}
            empty="No calls in this range."
            columns={[
              { header: "Action", cell: (r) => r.action },
              { header: "Count", cell: (r) => formatInt(r.actions), num: true },
              { header: "Calls", cell: (r) => formatInt(r.calls), num: true },
              { header: "Total", cell: (r) => formatUsd(r.cost_usd), num: true },
              { header: "Avg each", cell: (r) => formatUsd(r.avg_cost_usd), num: true },
              { header: "Avg time", cell: (r) => formatMs(r.avg_ms), num: true },
            ]}
          />
        </Section>

        <Section title="Paid, never shown" note="Responses billed but discarded (reported by the client)">
          <Table
            rows={raw.wasted}
            empty="None — every response reached the user."
            columns={[
              { header: "Reason", cell: (r) => r.reason },
              { header: "Actions", cell: (r) => formatInt(r.actions), num: true },
              { header: "Cost", cell: (r) => formatUsd(r.cost_usd), num: true },
            ]}
          />
        </Section>
      </div>

      <Section title="By step and model" note="Where retries, truncation and latency come from">
        <Table
          rows={raw.by_label}
          empty="No calls in this range."
          columns={[
            { header: "Step", cell: (r) => r.label },
            { header: "Model", cell: (r) => r.model },
            { header: "Calls", cell: (r) => formatInt(r.calls), num: true },
            { header: "Cost", cell: (r) => (r.cost_usd === null ? "unpriced" : formatUsd(r.cost_usd)), num: true },
            { header: "Wasted", cell: (r) => formatUsd(r.wasted_usd ?? null), num: true, warn: (r) => (r.wasted_usd ?? 0) > 0 },
            { header: "Retry", cell: (r) => formatPct(r.retry_pct), num: true, warn: (r) => r.retry_pct > 15 },
            { header: "Failed", cell: (r) => formatPct(r.failed_pct), num: true, warn: (r) => r.failed_pct > 0 },
            { header: "Truncated", cell: (r) => formatPct(r.truncated_pct), num: true, warn: (r) => r.truncated_pct > 0 },
            { header: "Cache hit", cell: (r) => formatPct(r.cache_hit_pct, 0), num: true },
            { header: "Avg out tok", cell: (r) => formatInt(r.avg_output_tokens), num: true },
            { header: "Avg time", cell: (r) => formatMs(r.avg_ms), num: true },
          ]}
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Top users">
          <Table
            rows={raw.top_users}
            empty="No usage in this range."
            columns={[
              { header: "User", cell: (r) => who(r.user_id) },
              { header: "Actions", cell: (r) => formatInt(r.actions), num: true },
              { header: "Calls", cell: (r) => formatInt(r.calls), num: true },
              { header: "Cost", cell: (r) => formatUsd(r.cost_usd), num: true },
            ]}
          />
        </Section>
        <Section title="Top projects">
          <Table
            rows={raw.top_projects}
            empty="No usage in this range."
            columns={[
              { header: "Project", cell: (r) => project(r.project_id) },
              { header: "Owner", cell: (r) => who(r.user_id) },
              { header: "Actions", cell: (r) => formatInt(r.actions), num: true },
              { header: "Cost", cell: (r) => formatUsd(r.cost_usd), num: true },
            ]}
          />
        </Section>
      </div>

      <Section title="Most expensive actions" note="Join a version to its cost: action id = the version's actionId">
        <Table
          rows={raw.top_actions}
          empty="No calls in this range."
          columns={[
            { header: "When", cell: (r) => new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ") },
            { header: "Action", cell: (r) => r.action },
            { header: "User", cell: (r) => who(r.user_id) },
            { header: "Project", cell: (r) => project(r.project_id) },
            { header: "Calls", cell: (r) => formatInt(r.calls), num: true },
            { header: "Retries", cell: (r) => formatInt(r.retries), num: true, warn: (r) => r.retries > 0 },
            { header: "Cost", cell: (r) => `${formatUsd(r.cost_usd)}${r.cost_complete ? "" : "+"}`, num: true },
            { header: "Time", cell: (r) => formatMs(r.total_ms), num: true },
            { header: "Discarded", cell: (r) => (r.discarded_reasons ?? []).join(", ") || "—" },
            { header: "Action id", cell: (r) => <code className="text-[11px]">{r.action_id}</code> },
          ]}
        />
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">A “+” means some of that action&apos;s calls have no configured price, so its true cost is higher.</p>
      </Section>

      <Section title="Recent failures" note="Latest 20 failed attempts (invalid output, no tool call, request errors)">
        <Table
          rows={raw.recent_failures}
          empty="No failed attempts in this range."
          columns={[
            { header: "When", cell: (r) => new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ") },
            { header: "Step", cell: (r) => `${r.label}${r.attempt > 0 ? ` (retry ${r.attempt})` : ""}` },
            { header: "Outcome", cell: (r) => r.outcome },
            { header: "Stop", cell: (r) => r.stop_reason ?? "—" },
            { header: "Error", cell: (r) => <span title={r.error ?? ""}>{r.error?.slice(0, 120) ?? "—"}</span> },
          ]}
        />
      </Section>
    </>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <Card padding="sm">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100")
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {note && <p className="text-[11px] text-slate-500 dark:text-slate-400">{note}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </Card>
  );
}

interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align (numbers). */
  num?: boolean;
  /** Highlight the cell amber for a value worth a look. */
  warn?: (row: T) => boolean;
}

function Table<T>({ rows, columns, empty }: { rows: T[]; columns: Column<T>[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {columns.map((c) => (
            <th key={c.header} className={"whitespace-nowrap px-2 py-1.5 font-medium " + (c.num ? "text-right" : "")}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {rows.map((row, i) => (
          <tr key={i} className="text-slate-700 dark:text-slate-300">
            {columns.map((c) => (
              <td
                key={c.header}
                className={
                  "whitespace-nowrap px-2 py-1.5 " +
                  (c.num ? "text-right tabular-nums " : "") +
                  (c.warn?.(row) ? "font-medium text-amber-600 dark:text-amber-400" : "")
                }
              >
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
