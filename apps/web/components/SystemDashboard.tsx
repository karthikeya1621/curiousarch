"use client";

import { useState } from "react";
import type { AiFinding, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { findingKey } from "../lib/findingKey";
import { getFixStatus } from "../lib/getFixStatus";
import { FlowDiagram } from "./FlowDiagram";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { ChevronDownIcon } from "./icons";

/**
 * `findingsOverride`, when provided, replaces the store's live findings
 * entirely — used to render a past version's static snapshot (see
 * page.tsx's preview layout) without touching `findingsStatus`/
 * `findingsStale`, neither of which applies to a snapshot that's already
 * settled and can never go stale relative to itself.
 */
export function SystemDashboard({
  model,
  findingsOverride,
  showResimulate,
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
  showResimulate?: boolean;
}) {
  // Collapsed by default on every mount — the health badge alone is
  // already color-coded (critical/warning/success), so the canvas below
  // is visible immediately instead of after scrolling past finding text.
  const [expanded, setExpanded] = useState(false);
  const liveFindings = useAppStore((s) => s.findings);
  const findingsStatus = useAppStore((s) => s.findingsStatus);
  const findingsStale = useAppStore((s) => s.findingsStale);
  const appliedFixes = useAppStore((s) => s.appliedFixes);
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const isPreview = findingsOverride !== undefined;
  const findings = isPreview ? findingsOverride : liveFindings;

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const healthy = !isPreview && findingsStatus === "done" && findings.length === 0;
  const isPreviewHealthy = isPreview && findings.length === 0;
  // Muted only once a fetch isn't already in flight — while loading, the
  // "Reviewing…" badge already carries that signal on its own. Never
  // stale for a static preview snapshot.
  const isStale = !isPreview && findingsStale && findingsStatus !== "loading";

  const healthBadge =
    !isPreview && findingsStatus === "loading" ? (
      <Badge tone="neutral">Reviewing…</Badge>
    ) : healthy || isPreviewHealthy ? (
      <Badge tone="success">Healthy</Badge>
    ) : (
      <Badge tone={criticalCount > 0 ? "critical" : "warning"}>
        {findings.length} issue{findings.length === 1 ? "" : "s"} found
      </Badge>
    );

  return (
    <div className="flex flex-col gap-5">
      <Card padding="sm">
        <button
          onClick={() => setExpanded((e) => !e)}
          disabled={findings.length === 0}
          className="flex w-full flex-wrap items-center justify-between gap-2 text-left enabled:cursor-pointer"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{model.name}</h2>
          <div className="flex items-center gap-1.5">
            {healthBadge}
            {findings.length > 0 && (
              <ChevronDownIcon
                className={"h-3.5 w-3.5 text-slate-400 transition-transform " + (expanded ? "rotate-180" : "")}
              />
            )}
          </div>
        </button>
        {healthy && (
          // A clean review is an ending with nowhere to go. Say what it means
          // (this scale, not forever) and what to try next.
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            No risks found at this scale. Raise the users or requests scale and Re-simulate to see what breaks next.
          </p>
        )}
        {expanded && findings.length > 0 && (
          <>
            <div
              className={
                "mt-3 flex max-h-28 flex-col gap-1.5 overflow-y-auto pr-1 transition-opacity " +
                (isStale ? "opacity-50" : "")
              }
            >
              {findings.map((f) => {
                // Never marked in a preview — appliedFixes/pendingFixes are
                // global, not scoped to the version being viewed, so
                // cross-referencing them against a past snapshot would be
                // misleading (they might reflect something that happened
                // after this version existed).
                const status = isPreview ? "none" : getFixStatus(f, appliedFixes, pendingFixes);
                return (
                  <div
                    key={findingKey(f)}
                    className={"flex items-start gap-2 text-sm " + (status !== "none" ? "opacity-60" : "")}
                  >
                    <Badge tone={f.severity === "critical" ? "critical" : "warning"}>
                      {f.severity}
                    </Badge>
                    {status === "queued" && <Badge tone="warning">Queued</Badge>}
                    {status === "fixed" && <Badge tone="success">Fixed</Badge>}
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{f.title}</span>
                      <span className="text-slate-400"> · {f.componentId}</span>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {status === "queued"
                          ? "Queued — Re-simulate to see this fix in action."
                          : status === "fixed"
                            ? "Fix applied — Re-simulate to confirm and refresh."
                            : f.explanation}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {isStale && (
              // Framed as the user's own pending changes, not as the app's
              // findings being wrong or "out of date" (which reads as a
              // fault) or "previous version" (which reads as an earlier
              // Re-simulate). Re-simulate is the deliberate, per-run step
              // that applies queued fixes and parameter changes — and will be
              // billed — so it has to be clear that nothing happens until
              // then. Amber to match the "Updates since last Re-simulate" box.
              <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                Your changes are pending — Re-simulate to apply them and refresh these findings.
              </p>
            )}
          </>
        )}
      </Card>

      <FlowDiagram model={model} findingsOverride={findingsOverride} showResimulate={showResimulate} />
    </div>
  );
}
