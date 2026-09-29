import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AiFinding, Component } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";
import { KIND_ICON, KIND_TONE } from "./kindStyle";

type ComponentNodeData = { component: Component; findings: AiFinding[] };

// memo: React Flow re-renders the node layer on unrelated changes (another
// node moving, selection, a findings update touching a different node), and
// this skips those. It does NOT skip the ~300ms layout animation — each
// frame changes this node's own `positionAbsoluteX/Y` props — so that cost
// is unchanged (and small: at most ~22 nodes).
export const ComponentNode = memo(function ComponentNode({ data }: NodeProps) {
  const { component, findings } = data as unknown as ComponentNodeData;
  const isOpen = useAppStore((s) => s.openComponentId === component.id);
  const openComponentDetail = useAppStore((s) => s.openComponentDetail);
  const KindIcon = KIND_ICON[component.kind];
  const hasCriticalFinding = findings.some((f) => f.severity === "critical");

  const border = isOpen
    ? "border-slate-400 ring-2 ring-slate-900/10 dark:border-slate-500 dark:ring-slate-100/10"
    : hasCriticalFinding
      ? "border-amber-300 ring-1 ring-amber-200 dark:border-amber-700 dark:ring-amber-900/40"
      : "border-slate-200 dark:border-slate-700";

  return (
    <div
      onClick={() => openComponentDetail(component)}
      className={`relative w-50 cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:bg-slate-800 dark:shadow-none dark:hover:shadow-[0_0_0_1px_var(--color-slate-600)] ${border}`}
    >
      {/* The keyboard way in: a real button over the whole card (the mouse click above still works). The diagram's own
          node focus is off (FlowDiagram `nodesFocusable={false}`), so each node is exactly one tab stop, and the failure
          badge sits above this in its own stacking layer. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openComponentDetail(component);
        }}
        aria-label={`${component.label}, ${component.kind}. ${findings.length} possible ${findings.length === 1 ? "failure" : "failures"}. Open details`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      />
      <Handle type="target" position={Position.Left} className="bg-slate-300! dark:bg-slate-600!" />
      <Handle type="source" position={Position.Right} className="bg-slate-300! dark:bg-slate-600!" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${KIND_TONE[component.kind]}`}
          >
            <KindIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {component.label}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {component.id} · {component.kind}
            </p>
          </div>
        </div>
        <FailureIndicator
          nodeId={component.id}
          findings={findings}
          wrapperClassName="relative z-10 shrink-0"
        />
      </div>
    </div>
  );
});
