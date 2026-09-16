import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Scenario } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";
import { TRAFFIC_NODE_ID } from "../lib/layout";

type TrafficNodeData = { scenarios: Scenario[] };

export function TrafficNode({ data }: NodeProps) {
  const { scenarios } = data as unknown as TrafficNodeData;
  const rps = useAppStore((s) => s.model.workload.rps);

  return (
    <div className="relative w-30 rounded-lg border border-gray-300 bg-gray-50 p-2 text-center">
      <Handle type="source" position={Position.Right} />
      <p className="text-xs font-semibold text-gray-700">Traffic</p>
      <p className="text-[10px] text-gray-500">{rps.toLocaleString()} rps</p>
      <FailureIndicator
        nodeId={TRAFFIC_NODE_ID}
        scenarios={scenarios}
        wrapperClassName="absolute -right-2 -top-2"
      />
    </div>
  );
}
