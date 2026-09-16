import { useEffect } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useScenarioDelta, useFixes } from "../lib/hooks";
import { FindingsList } from "./FindingsList";
import { FindingsCompareTable } from "./FindingsCompareTable";
import { UtilizationTable } from "./UtilizationTable";
import { FixResultPanel } from "./FixResultPanel";
import { Badge } from "./Badge";
import { XIcon, AlertTriangleIcon } from "./icons";

export function FailurePanel({
  model,
  scenarioId,
}: {
  model: SystemModel;
  scenarioId: string;
}) {
  const selectedFixId = useAppStore((s) => s.selectedFixId);
  const selectScenario = useAppStore((s) => s.selectScenario);
  const selectFix = useAppStore((s) => s.selectFix);

  const delta = useScenarioDelta(model, scenarioId);
  const fixes = useFixes(model, scenarioId);

  // Same fallback pattern as FixResultPanel: an invalid scenario id
  // shouldn't happen given the store's invariants, but collapse cleanly
  // rather than crash if it ever does.
  useEffect(() => {
    if (!delta) selectScenario(null);
  }, [delta, selectScenario]);

  if (!delta) return null;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{delta.scenario.label}</p>
          <p className="text-xs text-slate-500">{delta.scenario.description}</p>
        </div>
        <button
          onClick={() => selectScenario(null)}
          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Findings: baseline vs. under this failure
      </p>
      <FindingsCompareTable
        columns={[
          { label: "Before", findings: delta.baseline.findings },
          { label: "Failure", findings: delta.underScenario.findings },
        ]}
      />

      {delta.underScenario.findings.length > 0 && (
        <div className="mt-2.5">
          <FindingsList findings={delta.underScenario.findings} />
        </div>
      )}

      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Per-component utilization
      </p>
      <UtilizationTable
        before={delta.baseline.components}
        after={delta.underScenario.components}
      />

      {delta.newlyUnhealthy && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          This failure breaks a system that was healthy at baseline.
        </div>
      )}

      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {fixes.length === 0
          ? "No fixes to offer — this failure doesn't break anything at the current load."
          : `${fixes.length} fix(es) available`}
      </p>
      <div className="flex flex-col gap-1.5">
        {fixes.map((fix) => (
          <button
            key={fix.id}
            onClick={() => selectFix(fix.id)}
            className={
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors " +
              (selectedFixId === fix.id
                ? "border-blue-300 bg-blue-50"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50")
            }
          >
            <span className="font-medium text-slate-900">{fix.label}</span>
            <Badge tone="neutral" className="ml-2">
              targets {fix.targetsFindingCode}
            </Badge>
          </button>
        ))}
      </div>

      {selectedFixId && (
        <FixResultPanel model={model} scenarioId={scenarioId} fixId={selectedFixId} />
      )}
    </div>
  );
}
