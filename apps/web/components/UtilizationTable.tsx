import type { ComponentResult } from "@archsim/engine";

/**
 * Carried over from bin/whatif.ts deliberately, not decoration: aggregate
 * latency can hide the real early-warning signal (pooled servers can absorb
 * a lot of utilization increase before Erlang-C wait time moves at all —
 * discovered testing the cache-cold scenario against url-shortener, where
 * DB utilization jumped 4% -> 78% while latency barely moved).
 */
function barColor(saturated: boolean, utilization: number): string {
  if (saturated) return "bg-rose-500";
  if (utilization >= 0.8) return "bg-amber-500";
  return "bg-slate-400";
}

export function UtilizationTable({
  before,
  after,
}: {
  before: ComponentResult[];
  after: ComponentResult[];
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {before.map((b) => {
          const a = after.find((c) => c.componentId === b.componentId);
          if (!a) return null;
          const flag = a.saturated ? "SATURATED" : a.utilization >= 0.8 ? "high" : "";
          const barWidth = `${Math.min(100, a.utilization * 100)}%`;
          return (
            <tr key={b.componentId} className="align-middle">
              <td className="w-14 py-1 pr-2 font-mono text-xs text-slate-500">
                {b.componentId}
              </td>
              <td className="py-1 pr-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${barColor(a.saturated, a.utilization)}`}
                    style={{ width: barWidth }}
                  />
                </div>
              </td>
              <td className="whitespace-nowrap py-1 pr-1 text-right font-mono text-xs text-slate-500">
                {(b.utilization * 100).toFixed(1)}%
              </td>
              <td className="px-1 py-1 text-xs text-slate-300">→</td>
              <td className="whitespace-nowrap py-1 pl-1 text-right font-mono text-xs font-medium text-slate-900">
                {(a.utilization * 100).toFixed(1)}%
              </td>
              <td
                className={
                  "whitespace-nowrap py-1 pl-2 text-[10px] font-semibold " +
                  (flag === "SATURATED"
                    ? "text-rose-600"
                    : flag === "high"
                      ? "text-amber-600"
                      : "")
                }
              >
                {flag}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
