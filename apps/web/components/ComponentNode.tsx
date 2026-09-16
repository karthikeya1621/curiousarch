import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Component, Scenario } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";

type ComponentNodeData = { component: Component; scenarios: Scenario[] };

const KIND_DOT: Record<Component["kind"], string> = {
  gateway: "bg-slate-400",
  service: "bg-blue-500",
  cache: "bg-amber-500",
  database: "bg-violet-500",
  queue: "bg-teal-500",
};

export function ComponentNode({ data }: NodeProps) {
  const { component, scenarios } = data as unknown as ComponentNodeData;
  const isOpen = useAppStore((s) => s.openComponentId === component.id);

  return (
    <div
      className={
        "w-50 rounded-xl border bg-white p-3 shadow-sm transition-shadow " +
        (isOpen ? "border-slate-400 ring-2 ring-slate-900/10" : "border-slate-200")
      }
    >
      <Handle type="target" position={Position.Left} className="bg-slate-300!" />
      <Handle type="source" position={Position.Right} className="bg-slate-300!" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[component.kind]}`} />
            <p className="truncate text-sm font-semibold text-slate-900">
              {component.label}
            </p>
          </div>
          <p className="truncate pl-3 text-[11px] text-slate-400">
            {component.id} · {component.kind}
          </p>
        </div>
        <FailureIndicator
          nodeId={component.id}
          scenarios={scenarios}
          wrapperClassName="shrink-0"
        />
      </div>
    </div>
  );
}
