import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Component, Scenario } from "@archsim/engine";
import { FailureIndicator } from "./FailureIndicator";

type ComponentNodeData = { component: Component; scenarios: Scenario[] };

export function ComponentNode({ data }: NodeProps) {
  const { component, scenarios } = data as unknown as ComponentNodeData;

  return (
    <div className="w-50 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{component.label}</p>
          <p className="truncate text-[11px] text-gray-500">
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
