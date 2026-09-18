"use client";

import type { AiFinding, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { findingKey } from "../lib/findingKey";
import { FlowDiagram } from "./FlowDiagram";
import { Card } from "./Card";
import { Badge } from "./Badge";

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
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
}) {
  const liveFindings = useAppStore((s) => s.findings);
  const findingsStatus = useAppStore((s) => s.findingsStatus);
  const findingsStale = useAppStore((s) => s.findingsStale);
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{model.name}</h2>
          {healthBadge}
        </div>
        {findings.length > 0 && (
          <>
            <div
              className={
                "mt-3 flex max-h-28 flex-col gap-1.5 overflow-y-auto pr-1 transition-opacity " +
                (isStale ? "opacity-50" : "")
              }
            >
              {findings.map((f) => (
                <div key={findingKey(f)} className="flex items-start gap-2 text-sm">
                  <Badge tone={f.severity === "critical" ? "critical" : "warning"}>
                    {f.severity}
                  </Badge>
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900">{f.title}</span>
                    <span className="text-slate-400"> · {f.componentId}</span>
                    <p className="text-xs text-slate-500">{f.explanation}</p>
                  </div>
                </div>
              ))}
            </div>
            {isStale && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Based on the previous version of this system — click Re-simulate to refresh.
              </p>
            )}
          </>
        )}
      </Card>

      <FlowDiagram model={model} findingsOverride={findingsOverride} />
    </div>
  );
}
