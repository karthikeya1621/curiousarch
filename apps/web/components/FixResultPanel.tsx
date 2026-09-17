import { useEffect } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useFixResult } from "../lib/hooks";
import { FindingsList } from "./FindingsList";
import { FindingsCompareTable } from "./FindingsCompareTable";
import { CheckCircleIcon, XCircleIcon, XIcon } from "./icons";

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
  const applyFix = useAppStore((s) => s.applyFix);
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

  // A fix is applied to the REAL model, never the hypothetical
  // failure+fix combination previewed above (see store.ts's applyFix
  // comment) — so a fix whose target trait already holds for real (the
  // scenario only pretended it didn't) has nothing left to change. Catch
  // that here rather than letting the click silently do nothing.
  const realApplied = result.fix.apply(model);
  const isNoOp = JSON.stringify(realApplied) === JSON.stringify(model);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{result.fix.label}</p>
          <p className="text-xs text-slate-500">Tradeoff: {result.fix.tradeoff}</p>
        </div>
        <button
          onClick={() => selectFix(null)}
          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        <FindingsCompareTable
          columns={[
            { label: "Before", findings: result.baseline.findings },
            { label: "Failure", findings: result.underFailure.findings },
            { label: "+ Fix", findings: result.underFix.findings },
          ]}
        />
      </div>

      {result.underFix.findings.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            After this fix
          </p>
          <FindingsList findings={result.underFix.findings} />
        </div>
      )}

      <div
        className={
          "mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium " +
          (result.resolved
            ? "bg-emerald-50 text-emerald-700"
            : "bg-rose-50 text-rose-700")
        }
      >
        {result.resolved ? (
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
        ) : (
          <XCircleIcon className="h-4 w-4 shrink-0" />
        )}
        {result.resolved
          ? `Resolved — ${result.fix.targetsFindingCode} is no longer present.`
          : `Not resolved — ${result.fix.targetsFindingCode} is still present after this fix.`}
      </div>

      {otherFindings.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          This fix doesn&apos;t target: {otherFindings.map((f) => f.code).join(", ")}
        </p>
      )}

      <button
        onClick={() => applyFix(realApplied)}
        disabled={isNoOp}
        className="mt-3 w-full rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Apply this fix
      </button>
      <p className="mt-1.5 text-center text-[11px] text-slate-400">
        {isNoOp
          ? "Your real system already has this — the failure above was only hypothetical, so there's nothing to change."
          : "Makes this change to the real model — not the hypothetical failure above. Undo reverts it."}
      </p>
    </div>
  );
}
