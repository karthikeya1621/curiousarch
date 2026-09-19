import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AiFinding, Component } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailureIndicator } from "./FailureIndicator";
import {
  GatewayIcon,
  ServiceIcon,
  CacheIcon,
  DatabaseIcon,
  QueueIcon,
  ExternalDependencyIcon,
  LoadBalancerIcon,
  MessageBrokerIcon,
  CdnIcon,
  ObjectStorageIcon,
  ScheduledJobIcon,
  ConfigStoreIcon,
} from "./icons";

type ComponentNodeData = { component: Component; findings: AiFinding[] };

const KIND_ICON: Record<Component["kind"], (props: { className?: string }) => React.JSX.Element> = {
  gateway: GatewayIcon,
  service: ServiceIcon,
  cache: CacheIcon,
  database: DatabaseIcon,
  queue: QueueIcon,
  "external-dependency": ExternalDependencyIcon,
  "load-balancer": LoadBalancerIcon,
  "message-broker": MessageBrokerIcon,
  cdn: CdnIcon,
  "object-storage": ObjectStorageIcon,
  "scheduled-job": ScheduledJobIcon,
  "config-store": ConfigStoreIcon,
};

// Cyan (the app's own primary accent — Re-simulate, the chat FAB) is
// deliberately never used here, same reasoning that already kept queue's
// teal distinct from it — a node's kind color should never look like the
// app's own call-to-action color.
const KIND_TONE: Record<Component["kind"], string> = {
  gateway: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300",
  service: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  cache: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  database: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
  queue: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300",
  "external-dependency": "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
  "load-balancer": "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300",
  "message-broker": "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  cdn: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
  "object-storage": "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300",
  "scheduled-job": "bg-lime-50 text-lime-600 dark:bg-lime-950/40 dark:text-lime-300",
  "config-store": "bg-pink-50 text-pink-600 dark:bg-pink-950/40 dark:text-pink-300",
};

export function ComponentNode({ data }: NodeProps) {
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
      className={`w-50 cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:bg-slate-800 dark:shadow-none dark:hover:shadow-[0_0_0_1px_var(--color-slate-600)] ${border}`}
    >
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
            <p className="truncate text-[11px] text-slate-400">
              {component.id} · {component.kind}
            </p>
          </div>
        </div>
        <FailureIndicator
          nodeId={component.id}
          findings={findings}
          wrapperClassName="shrink-0"
        />
      </div>
    </div>
  );
}
