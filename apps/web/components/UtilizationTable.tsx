import type { ComponentResult } from "@archsim/engine";

/**
 * Carried over from bin/whatif.ts deliberately, not decoration: aggregate
 * latency can hide the real early-warning signal (pooled servers can absorb
 * a lot of utilization increase before Erlang-C wait time moves at all —
 * discovered testing the cache-cold scenario against url-shortener, where
 * DB utilization jumped 4% -> 78% while latency barely moved).
 */
export function UtilizationTable({
  before,
  after,
}: {
  before: ComponentResult[];
  after: ComponentResult[];
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {before.map((b) => {
          const a = after.find((c) => c.componentId === b.componentId);
          if (!a) return null;
          const flag = a.saturated
            ? "SATURATED"
            : a.utilization >= 0.8
              ? "high"
              : "";
          return (
            <tr key={b.componentId}>
              <td className="py-0.5 pr-3 font-mono text-gray-600">
                {b.componentId}
              </td>
              <td className="py-0.5 pr-1 text-right font-mono">
                {(b.utilization * 100).toFixed(1)}%
              </td>
              <td className="py-0.5 px-1 text-gray-400">→</td>
              <td className="py-0.5 pl-1 text-right font-mono">
                {(a.utilization * 100).toFixed(1)}%
              </td>
              <td
                className={
                  "py-0.5 pl-2 text-xs font-semibold " +
                  (flag === "SATURATED"
                    ? "text-red-700"
                    : flag === "high"
                      ? "text-amber-700"
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
