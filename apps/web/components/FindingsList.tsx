import type { Finding } from "@archsim/engine";
import { CheckCircleIcon, AlertTriangleIcon, XCircleIcon } from "./icons";

/**
 * Severity gets distinct visual treatment, not a comma-joined code list —
 * PLAN-1.5's specific point: warnings must read differently from criticals,
 * or an all-red UI trains users to ignore red.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
        <CheckCircleIcon className="h-4 w-4" />
        No findings.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {findings.map((f) => {
        const critical = f.severity === "critical";
        return (
          <li
            key={`${f.code}-${f.componentId}`}
            className={
              "rounded-lg border px-3 py-2 " +
              (critical
                ? "border-rose-200 bg-rose-50"
                : "border-amber-200 bg-amber-50")
            }
          >
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {critical ? (
                <XCircleIcon className="h-4 w-4 shrink-0 text-rose-600" />
              ) : (
                <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
              )}
              <span className={critical ? "text-rose-800" : "text-amber-800"}>
                {f.code}
              </span>
              <span className="font-normal text-slate-400">
                @ {f.componentId}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 font-mono text-xs text-slate-500">
              {Object.entries(f.evidence).map(([key, value]) => (
                <span key={key}>
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
