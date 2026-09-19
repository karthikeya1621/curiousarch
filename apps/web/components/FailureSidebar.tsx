"use client";

import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { findingKey } from "../lib/findingKey";
import { getFixStatus } from "../lib/getFixStatus";
import { FindingPanel } from "./FindingPanel";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { XIcon, AlertTriangleIcon, SparklesIcon } from "./icons";

/**
 * Lives in the sidebar next to ControlPanel, not inside FlowDiagram — a
 * diagram node is too small to host the finding list or FindingPanel, and
 * anything popped over the canvas gets clipped by React Flow's own
 * pannable-viewport overflow. Indicator badges on nodes only set
 * `openComponentId`; this renders what that selection means, reading
 * `findings` straight from the store (fetched once per model change, not
 * recomputed per render like the old deterministic `useScenarios`).
 */
export function FailureSidebar({ model }: { model: SystemModel }) {
  const findings = useAppStore((s) => s.findings);
  const findingsStatus = useAppStore((s) => s.findingsStatus);
  const findingsError = useAppStore((s) => s.findingsError);
  const openComponentId = useAppStore((s) => s.openComponentId);
  const selectedFindingId = useAppStore((s) => s.selectedFindingId);
  const selectFinding = useAppStore((s) => s.selectFinding);
  const setOpenComponentId = useAppStore((s) => s.setOpenComponentId);
  const appliedFixes = useAppStore((s) => s.appliedFixes);
  const pendingFixes = useAppStore((s) => s.pendingFixes);

  const activeFinding = findings.find((f) => findingKey(f) === selectedFindingId);

  if (activeFinding) {
    return (
      <Card padding="sm">
        <FindingPanel model={model} finding={activeFinding} />
      </Card>
    );
  }

  if (findingsStatus === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
        <SparklesIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <span>Reviewing this architecture…</span>
      </div>
    );
  }

  if (findingsError) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-rose-300 bg-rose-50/60 p-4 text-xs text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{findingsError}</span>
      </div>
    );
  }

  if (!openComponentId) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>Click a node&apos;s failure-count badge to see what could go wrong there.</span>
      </div>
    );
  }

  const relevant = findings.filter((f) => f.componentId === openComponentId);

  return (
    <Card padding="sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Possible failures</p>
        <button
          onClick={() => setOpenComponentId(null)}
          aria-label="Close"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {relevant.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">No issues found here — looks solid.</p>
        )}
        {relevant.map((f) => {
          const status = getFixStatus(f, appliedFixes, pendingFixes);
          return (
            <button
              key={findingKey(f)}
              onClick={() => selectFinding(findingKey(f))}
              className={
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-500 dark:hover:bg-slate-700 " +
                (status !== "none" ? "border-slate-100 opacity-60 dark:border-slate-700" : "border-slate-200 dark:border-slate-600")
              }
            >
              <div className="flex items-center gap-1.5">
                <Badge tone={f.severity === "critical" ? "critical" : "warning"}>{f.severity}</Badge>
                {status === "queued" && <Badge tone="warning">Queued</Badge>}
                {status === "fixed" && <Badge tone="success">Fixed</Badge>}
                <span className="font-medium text-slate-900 dark:text-slate-100">{f.title}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {status === "queued"
                  ? "Queued — Re-simulate to see this fix in action."
                  : status === "fixed"
                    ? "Fix applied — Re-simulate to confirm and refresh this list."
                    : f.explanation}
              </p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
