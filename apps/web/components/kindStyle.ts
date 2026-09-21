import type { Component } from "@archsim/engine";
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

/**
 * The one place a component kind's icon and color live — previously
 * copy-pasted into both ComponentNode.tsx (the diagram card) and
 * ComponentDetailModal.tsx with a comment saying they were "kept in sync by
 * hand", which is exactly how adding the 7 extended kinds meant editing
 * both. Typed as `Record<Component["kind"], …>` so a new kind is a compile
 * error here until it has both, not a silently blank icon.
 */
export const KIND_ICON: Record<Component["kind"], (props: { className?: string }) => React.JSX.Element> = {
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
export const KIND_TONE: Record<Component["kind"], string> = {
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
