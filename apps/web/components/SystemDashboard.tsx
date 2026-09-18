"use client";

import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { findingKey } from "../lib/findingKey";
import { FlowDiagram } from "./FlowDiagram";
import { Card } from "./Card";
import { Badge } from "./Badge";

export function SystemDashboard({ model }: { model: SystemModel }) {
  const findings = useAppStore((s) => s.findings);
  const findingsStatus = useAppStore((s) => s.findingsStatus);

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const healthy = findingsStatus === "done" && findings.length === 0;

  const healthBadge =
    findingsStatus === "loading" ? (
      <Badge tone="neutral">Reviewing…</Badge>
    ) : healthy ? (
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
          <div className="mt-3 flex flex-col gap-1.5">
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
        )}
      </Card>

      <FlowDiagram model={model} />
    </div>
  );
}
