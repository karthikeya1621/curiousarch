/**
 * Number formatting for the admin usage page. Costs here are fractions of a
 * cent per call, so the precision scales with the amount instead of a flat
 * two decimals that would show "$0.00" for most rows.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `$${value.toFixed(digits)}`;
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

/** `part` as a percentage of `whole`, or null when there's nothing to divide by. */
export function ratioPct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * One entry per calendar day (UTC) for the last `days` days, zero-filled —
 * the database only returns days that had calls, and a chart with gaps closed
 * up would misrepresent a quiet stretch as a busy one. Oldest first, ending
 * on `today`. `wasted_usd` (spend on attempts that produced nothing usable)
 * defaults to 0 for a database function that predates it.
 */
export function fillDays(
  rows: { day: string; cost_usd: number | null; wasted_usd?: number | null; calls: number }[],
  days: number,
  today: Date = new Date(),
): { day: string; cost_usd: number; wasted_usd: number; calls: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; cost_usd: number; wasted_usd: number; calls: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    const row = byDay.get(day);
    out.push({ day, cost_usd: row?.cost_usd ?? 0, wasted_usd: row?.wasted_usd ?? 0, calls: row?.calls ?? 0 });
  }
  return out;
}
