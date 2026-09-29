import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore } from "../lib/store";
import { formatTier } from "../lib/formatTier";
import { ActivityIcon } from "./icons";

/**
 * No FailureIndicator here — an `AiFinding.componentId` always names a
 * real component (see identifyFailures.ts's prompt), never this synthetic
 * traffic node, so there's nothing to badge. Shows whichever workload
 * dimension(s) are `included`, at whatever tier is currently set.
 */
export const TrafficNode = memo(function TrafficNode(_props: NodeProps) {
  const workload = useAppStore((s) => s.model.workload);

  const lines: string[] = [];
  if (workload.users?.included) lines.push(`${formatTier(workload.users.tier)} users`);
  if (workload.requests?.included) lines.push(`${formatTier(workload.requests.tier)} req/s`);

  return (
    <div className="relative w-30 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center dark:border-slate-700 dark:bg-slate-900">
      <Handle type="source" position={Position.Right} className="bg-slate-300! dark:bg-slate-600!" />
      <ActivityIcon className="mx-auto h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
      <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">Traffic</p>
      {lines.map((line) => (
        <p key={line} className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
          {line}
        </p>
      ))}
    </div>
  );
});
