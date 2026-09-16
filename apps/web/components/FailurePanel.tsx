import { useEffect } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useScenarioDelta, useFixes } from "../lib/hooks";
import { FindingsList } from "./FindingsList";
import { UtilizationTable } from "./UtilizationTable";
import { FixResultPanel } from "./FixResultPanel";

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
    <div className="mt-3 rounded-lg border border-gray-300 bg-gray-50 p-3">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{delta.scenario.label}</p>
          <p className="text-xs text-gray-600">{delta.scenario.description}</p>
        </div>
        <button
          onClick={() => selectScenario(null)}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-semibold text-gray-500">Baseline</p>
          <FindingsList findings={delta.baseline.findings} />
        </div>
        <div>
          <p className="mb-1 font-semibold text-gray-500">Under this failure</p>
          <FindingsList findings={delta.underScenario.findings} />
        </div>
      </div>

      <p className="mb-1 mt-3 text-xs font-semibold text-gray-500">
        Per-component utilization
      </p>
      <UtilizationTable
        before={delta.baseline.components}
        after={delta.underScenario.components}
      />

      {delta.newlyUnhealthy && (
        <p className="mt-2 text-sm font-medium text-red-700">
          ⚠ This failure breaks a system that was healthy at baseline.
        </p>
      )}

      <p className="mb-1 mt-3 text-xs font-semibold text-gray-500">
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
              "rounded border px-2 py-1.5 text-left text-sm transition-colors " +
              (selectedFixId === fix.id
                ? "border-blue-400 bg-blue-50"
                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50")
            }
          >
            <span className="font-medium">{fix.label}</span>
            <span className="ml-2 text-xs text-gray-500">
              targets {fix.targetsFindingCode}
            </span>
          </button>
        ))}
      </div>

      {selectedFixId && (
        <FixResultPanel model={model} scenarioId={scenarioId} fixId={selectedFixId} />
      )}
    </div>
  );
}
