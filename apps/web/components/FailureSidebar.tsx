"use client";

import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useScenarios } from "../lib/hooks";
import { scenarioComponentId } from "../lib/scenarioComponentId";
import { TRAFFIC_NODE_ID } from "../lib/layout";
import { FailurePanel } from "./FailurePanel";
import { Card } from "./Card";
import { XIcon, AlertTriangleIcon } from "./icons";

/**
 * Lives in the sidebar next to ControlPanel, not inside FlowDiagram — a
 * diagram node is too small to host the failure list or FailurePanel
 * (findings + utilization + fixes), and anything popped over the canvas
 * gets clipped by React Flow's own pannable-viewport overflow. Indicator
 * badges on nodes only set `openComponentId`; this renders what that
 * selection means.
 */
export function FailureSidebar({ model }: { model: SystemModel }) {
  const scenarios = useScenarios(model);
  const openComponentId = useAppStore((s) => s.openComponentId);
  const selectedScenarioId = useAppStore((s) => s.selectedScenarioId);
  const selectScenario = useAppStore((s) => s.selectScenario);
  const setOpenComponentId = useAppStore((s) => s.setOpenComponentId);

  const activeScenario = scenarios.find((s) => s.id === selectedScenarioId);

  if (activeScenario) {
    return (
      <Card padding="sm">
        <FailurePanel model={model} scenarioId={activeScenario.id} />
      </Card>
    );
  }

  if (!openComponentId) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs text-slate-500">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>Click a node&apos;s failure-count badge to see what could go wrong there.</span>
      </div>
    );
  }

  const relevant = scenarios.filter(
    (s) => (scenarioComponentId(s) ?? TRAFFIC_NODE_ID) === openComponentId,
  );

  return (
    <Card padding="sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Possible failures</p>
        <button
          onClick={() => setOpenComponentId(null)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {relevant.map((s) => (
          <button
            key={s.id}
            onClick={() => selectScenario(s.id)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <span className="font-medium text-slate-900">{s.label}</span>
            <p className="text-xs text-slate-500">{s.description}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}
