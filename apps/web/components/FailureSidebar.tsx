"use client";

import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useScenarios } from "../lib/hooks";
import { scenarioComponentId } from "../lib/scenarioComponentId";
import { TRAFFIC_NODE_ID } from "../lib/layout";
import { FailurePanel } from "./FailurePanel";

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
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <FailurePanel model={model} scenarioId={activeScenario.id} />
      </div>
    );
  }

  if (!openComponentId) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-500">
        Click a node&apos;s failure-count badge to see what could go wrong there.
      </div>
    );
  }

  const relevant = scenarios.filter(
    (s) => (scenarioComponentId(s) ?? TRAFFIC_NODE_ID) === openComponentId,
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">Possible failures</p>
        <button
          onClick={() => setOpenComponentId(null)}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {relevant.map((s) => (
          <button
            key={s.id}
            onClick={() => selectScenario(s.id)}
            className="rounded border border-gray-200 px-2 py-1.5 text-left text-sm hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium">{s.label}</span>
            <p className="text-xs text-gray-500">{s.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
