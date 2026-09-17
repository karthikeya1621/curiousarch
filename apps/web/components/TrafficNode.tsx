import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Scenario } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";
import { TRAFFIC_NODE_ID } from "../lib/layout";
import { ActivityIcon } from "./icons";

type TrafficNodeData = { scenarios: Scenario[] };

export function TrafficNode({ data }: NodeProps) {
  const { scenarios } = data as unknown as TrafficNodeData;
  const scale = useAppStore((s) => s.model.workload.scale.value);
  const isOpen = useAppStore((s) => s.openComponentId === TRAFFIC_NODE_ID);

  return (
    <div
      className={
        "relative w-30 rounded-xl border bg-slate-50 p-2.5 text-center transition-shadow " +
        (isOpen ? "border-slate-400 ring-2 ring-slate-900/10" : "border-slate-200")
      }
    >
      <Handle type="source" position={Position.Right} className="bg-slate-300!" />
      <ActivityIcon className="mx-auto h-3.5 w-3.5 text-slate-400" />
      <p className="mt-0.5 text-xs font-semibold text-slate-700">Traffic</p>
      <p className="font-mono text-[10px] text-slate-400">{scale} scale</p>
      <FailureIndicator
        nodeId={TRAFFIC_NODE_ID}
        scenarios={scenarios}
        wrapperClassName="absolute -right-2 -top-2"
      />
    </div>
  );
}
