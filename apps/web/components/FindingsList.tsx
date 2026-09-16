import type { Finding } from "@archsim/engine";

/**
 * Severity gets distinct visual treatment, not a comma-joined code list —
 * PLAN-1.5's specific point: warnings must read differently from criticals,
 * or an all-red UI trains users to ignore red.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-green-700">No findings.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {findings.map((f) => (
        <li
          key={`${f.code}-${f.componentId}`}
          className={
            "rounded px-2 py-1 text-sm " +
            (f.severity === "critical"
              ? "bg-red-50 text-red-800"
              : "bg-amber-50 text-amber-800")
          }
        >
          <span className="font-semibold uppercase text-xs mr-2">
            {f.severity}
          </span>
          {f.code} <span className="text-gray-500">@ {f.componentId}</span>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-gray-600">
            {Object.entries(f.evidence).map(([key, value]) => (
              <span key={key}>
                {key}: {String(value)}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
