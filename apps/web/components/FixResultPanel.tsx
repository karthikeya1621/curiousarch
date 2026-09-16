import { useEffect } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useFixResult } from "../lib/hooks";
import { FindingsList } from "./FindingsList";

export function FixResultPanel({
  model,
  scenarioId,
  fixId,
}: {
  model: SystemModel;
  scenarioId: string;
  fixId: string;
}) {
  const selectFix = useAppStore((s) => s.selectFix);
  const result = useFixResult(model, scenarioId, fixId);

  // Selection was invalid (shouldn't happen given the store's invariants,
  // but the engine throws on an unknown id and this is the fallback) —
  // collapse back to the failure list rather than showing nothing. The
  // reset is a useEffect, not a direct call during render: updating store
  // state mid-render is unsafe in React.
  useEffect(() => {
    if (!result) selectFix(null);
  }, [result, selectFix]);

  if (!result) return null;

  const otherFindings = result.underFix.findings.filter(
    (f) => f.code !== result.fix.targetsFindingCode,
  );

  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{result.fix.label}</p>
          <p className="text-xs text-gray-600">Tradeoff: {result.fix.tradeoff}</p>
        </div>
        <button
          onClick={() => selectFix(null)}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="mb-1 font-semibold text-gray-500">Baseline</p>
          <FindingsList findings={result.baseline.findings} />
        </div>
        <div>
          <p className="mb-1 font-semibold text-gray-500">Under failure</p>
          <FindingsList findings={result.underFailure.findings} />
        </div>
        <div>
          <p className="mb-1 font-semibold text-gray-500">Failure + fix</p>
          <FindingsList findings={result.underFix.findings} />
        </div>
      </div>

      <div className="mt-3 rounded px-2 py-1.5 text-sm font-medium">
        {result.resolved ? (
          <span className="text-green-700">
            ✓ Resolved — {result.fix.targetsFindingCode} is no longer present.
          </span>
        ) : (
          <span className="text-red-700">
            ✗ Not resolved — {result.fix.targetsFindingCode} is still present after this fix.
          </span>
        )}
      </div>

      {otherFindings.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          This fix doesn&apos;t target: {otherFindings.map((f) => f.code).join(", ")}
        </p>
      )}
    </div>
  );
}
