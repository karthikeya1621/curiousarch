/**
 * Structural component helpers — properties derivable from a component's
 * kind alone, independent of graph context (arrival, load, replication
 * pressure).
 *
 * This file used to also hold the numeric capacity model (M/M/c profiles,
 * `capacityOf`, `evaluate`) — deleted along with `queueing.ts` when the
 * engine moved from simulating queueing math on guessed magnitudes to
 * categorical traits. `isAsyncBoundary` is the one piece of that era
 * that's still load-bearing: it's exactly the signal the web app's own
 * diagram (`apps/web/lib/layout.ts`) needs to render an edge as async — a
 * synchronous chain stops at a queue, because the caller doesn't wait for
 * it to drain — and it never depended on any numeric parameter to begin
 * with.
 */

import type { Component } from "./types.ts";

/**
 * A queue decouples caller from worker: the caller's latency is the enqueue,
 * not the drain. A synchronous failure chain stops here.
 */
export function isAsyncBoundary(component: Component): boolean {
  return component.kind === "queue";
}
