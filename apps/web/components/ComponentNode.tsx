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

/**
 * Horizontal scaling — "how many parallel copies of this" — shown as a
 * plain "×N" appended to the existing subtitle text, not a separate
 * element: no extra DOM per node, so it costs nothing extra during
 * animateNodes' every-frame relayout re-render. Deliberately not the
 * combined ComponentProfile.servers figure (components.ts) for a service —
 * that's instances * concurrencyPerInstance, conflating this with vertical
 * scaling (concurrencyPerInstance, a per-instance property) — but each
 * kind's own count-type field: the one thing you'd literally add more of.
 * Cache has no such field (components.ts pins it at exactly 1 server,
 * always — there is no horizontal lever to show), and a gateway has no
 * server concept at all, so neither gets a count.
 */
function horizontalCount(component: Component): number | null {
  switch (component.kind) {
    case "service":
      return component.instances.value;
    case "database":
      return component.connectionPoolSize.value;
    case "queue":
      return component.consumers.value;
    case "cache":
    case "gateway":
      return null;
  }
}

export function ComponentNode({ data }: NodeProps) {
  const { component, scenarios } = data as unknown as ComponentNodeData;
  const isOpen = useAppStore((s) => s.openComponentId === component.id);
  const KindIcon = KIND_ICON[component.kind];
  const count = horizontalCount(component);

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
              {count !== null ? ` · ×${count}` : ""}
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
