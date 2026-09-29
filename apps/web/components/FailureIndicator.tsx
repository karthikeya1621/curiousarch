"use client";

import type { AiFinding } from "@archsim/engine";
import { useAppStore } from "../lib/store";

/**
 * The indicator badge on a flow-diagram node. Deliberately renders no
 * popover of its own: a node is too small to host the finding list or the
 * (much larger) FindingPanel, and anything absolutely positioned off a
 * node gets clipped by React Flow's pannable viewport (`overflow: hidden`
 * on the pane) the moment it extends past the diagram's visible bounds —
 * confirmed by trying exactly that first. Clicking the badge instead
 * records `openComponentId` in the store; FailureSidebar (in the same
 * sidebar column as ControlPanel, not inside the diagram) renders the
 * actual list and detail panel.
 */
export function FailureIndicator({
  nodeId,
  findings,
  wrapperClassName,
}: {
  nodeId: string;
  findings: AiFinding[];
  wrapperClassName?: string;
}) {
  const openComponentId = useAppStore((s) => s.openComponentId);
  const setOpenComponentId = useAppStore((s) => s.setOpenComponentId);

  if (findings.length === 0) return null;

  const isOpen = openComponentId === nodeId;

  return (
    <div className={wrapperClassName}>
      <button
        className={
          // Dark text: white on amber was about 1.7:1. Selected is a stronger amber, not a darker one that would need white again.
          "nodrag flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-900 ring-2 ring-white transition-colors dark:ring-slate-800 " +
          (isOpen ? "bg-amber-500" : "bg-amber-400 hover:bg-amber-300")
        }
        aria-label={`${findings.length} possible ${findings.length === 1 ? "failure" : "failures"} on ${nodeId}`}
        aria-expanded={isOpen}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // Otherwise this bubbles up into ComponentNode's own onClick and
          // opens the property-detail modal underneath at the same time.
          e.stopPropagation();
          setOpenComponentId(isOpen ? null : nodeId);
        }}
        title={`${findings.length} possible failure(s)`}
      >
        {findings.length}
      </button>
    </div>
  );
}
