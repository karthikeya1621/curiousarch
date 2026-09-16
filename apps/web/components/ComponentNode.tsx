import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Component, Scenario } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";
import { GatewayIcon, ServiceIcon, CacheIcon, DatabaseIcon, QueueIcon } from "./icons";

type ComponentNodeData = { component: Component; scenarios: Scenario[] };

const KIND_ICON: Record<Component["kind"], (props: { className?: string }) => React.JSX.Element> = {
  gateway: GatewayIcon,
  service: ServiceIcon,
  cache: CacheIcon,
  database: DatabaseIcon,
  queue: QueueIcon,
};

const KIND_TONE: Record<Component["kind"], string> = {
  gateway: "bg-slate-100 text-slate-500",
  service: "bg-blue-50 text-blue-600",
  cache: "bg-amber-50 text-amber-600",
  database: "bg-violet-50 text-violet-600",
  queue: "bg-teal-50 text-teal-600",
};

export function ComponentNode({ data }: NodeProps) {
  const { component, scenarios } = data as unknown as ComponentNodeData;
  const isOpen = useAppStore((s) => s.openComponentId === component.id);
  const KindIcon = KIND_ICON[component.kind];

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
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${KIND_TONE[component.kind]}`}
          >
            <KindIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {component.label}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {component.id} · {component.kind}
            </p>
          </div>
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
