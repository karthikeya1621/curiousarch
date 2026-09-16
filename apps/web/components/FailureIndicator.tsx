"use client";

import type { Scenario } from "@archsim/engine";
import { useAppStore } from "../lib/store";

/**
 * The indicator badge on a flow-diagram node. Deliberately renders no
 * popover of its own: a node is too small to host the failure list or the
 * (much larger) FailurePanel, and anything absolutely positioned off a
 * node gets clipped by React Flow's pannable viewport (`overflow: hidden`
 * on the pane) the moment it extends past the diagram's visible bounds —
 * confirmed by trying exactly that first. Clicking the badge instead
 * records `openComponentId` in the store; FailureSidebar (in the same
 * sidebar column as ControlPanel, not inside the diagram) renders the
 * actual list and detail panel.
 */
export function FailureIndicator({
  nodeId,
  scenarios,
  wrapperClassName,
}: {
  nodeId: string;
  scenarios: Scenario[];
  wrapperClassName?: string;
}) {
  const openComponentId = useAppStore((s) => s.openComponentId);
  const setOpenComponentId = useAppStore((s) => s.setOpenComponentId);
  const selectScenario = useAppStore((s) => s.selectScenario);

  if (scenarios.length === 0) return null;

  const isOpen = openComponentId === nodeId;

  return (
    <div className={wrapperClassName}>
      <button
        className={
          "nodrag flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white transition-colors " +
          (isOpen ? "bg-amber-600" : "bg-amber-400 hover:bg-amber-500")
        }
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (isOpen) {
            setOpenComponentId(null);
          } else {
            setOpenComponentId(nodeId);
            selectScenario(null);
          }
        }}
        title={`${scenarios.length} possible failure(s)`}
      >
        {scenarios.length}
      </button>
    </div>
  );
}
