/**
 * Per-component capacity models.
 *
 * Each model answers three questions and nothing else:
 *   1. How much load can this sustain? (capacityRps)
 *   2. What latency does it add at this load? (mean, p99)
 *   3. Is it an async boundary? (does the caller wait?)
 *
 * Anything requiring graph context — arrival rates, herd load, replication
 * pressure — lives in solver.ts, not here.
 */

import { mmc, responseQuantile } from "./queueing.js";
import type { Component, ComponentResult } from "./types.js";

export interface ComponentProfile {
  /** Parallel service channels: pool size, thread count, consumer count. */
  servers: number;
  /** Mean service time in seconds for one channel. */
  serviceTimeSeconds: number;
}

/**
 * Reduce a component to the (servers, service time) pair the queueing math
 * needs. Returning null means "not a queueing station" — a gateway admits or
 * rejects, it does not queue.
 */
export function profileOf(component: Component): ComponentProfile | null {
  switch (component.kind) {
    case "gateway":
      return null;

    case "service":
      return {
        servers:
          component.instances.value * component.concurrencyPerInstance.value,
        serviceTimeSeconds: component.serviceTimeMs.value / 1000,
      };

    case "cache":
      // Redis is effectively single-threaded per shard, but the server is
      // only busy for cpuTimeMs per op — hitLatencyMs is the client-observed
      // round trip, dominated by network transit for a remote cache, and
      // does not occupy the server. Capacity must be sized on the former;
      // using hitLatencyMs here made a 1ms cache look capped at 1,000 rps,
      // orders of magnitude below real single-instance Redis throughput.
      // See evaluate() for how hitLatencyMs still drives the reported
      // latency despite not being the capacity-determining service time.
      return {
        servers: 1,
        serviceTimeSeconds: component.cpuTimeMs.value / 1000,
      };

    case "database":
      // The pool is the constraint, not the disk. Each connection is one
      // server; a query occupies it for queryTimeMs. This is exactly why pool
      // exhaustion shows up long before CPU does.
      return {
        servers: component.connectionPoolSize.value,
        serviceTimeSeconds: component.queryTimeMs.value / 1000,
      };

    case "queue":
      return {
        servers: component.consumers.value,
        serviceTimeSeconds: component.consumerServiceTimeMs.value / 1000,
      };
  }
}

/** Sustainable throughput before the queue grows without bound. */
export function capacityOf(component: Component): number {
  if (component.kind === "gateway") return component.maxRps.value;
  const profile = profileOf(component)!;
  return profile.servers / profile.serviceTimeSeconds;
}

/**
 * A queue decouples caller from worker: the caller's latency is the enqueue,
 * not the drain. End-to-end synchronous latency stops here.
 */
export function isAsyncBoundary(component: Component): boolean {
  return component.kind === "queue";
}

/**
 * Fraction of arriving traffic that continues downstream.
 * Cache hits terminate; everything else passes through.
 */
export function outflowFactor(component: Component, arrivalRps: number): number {
  switch (component.kind) {
    case "cache":
      return 1 - component.hitRate.value;
    case "queue": {
      // A backed-up queue only forwards what its consumers can drain.
      const drain = capacityOf(component);
      return arrivalRps > 0 ? Math.min(1, drain / arrivalRps) : 1;
    }
    default:
      return 1;
  }
}

export function evaluate(
  component: Component,
  arrivalRps: number,
): ComponentResult {
  const capacityRps = capacityOf(component);

  if (component.kind === "gateway") {
    return {
      componentId: component.id,
      arrivalRps,
      capacityRps,
      utilization: capacityRps > 0 ? arrivalRps / capacityRps : 0,
      meanLatencyMs: 0,
      p99LatencyMs: 0,
      concurrentRequests: 0,
      saturated: arrivalRps > capacityRps,
    };
  }

  const { servers, serviceTimeSeconds } = profileOf(component)!;
  const serviceRate = 1 / serviceTimeSeconds;
  const metrics = mmc(arrivalRps, serviceRate, servers);
  const p99 = responseQuantile(arrivalRps, serviceRate, servers, 0.99);

  if (component.kind === "cache") {
    if (!metrics.stable) {
      return {
        componentId: component.id,
        arrivalRps,
        capacityRps,
        utilization: metrics.utilization,
        meanLatencyMs: Infinity,
        p99LatencyMs: Infinity,
        concurrentRequests: Infinity,
        saturated: true,
      };
    }
    // Reported latency is queueing wait (from cpuTimeMs-based contention,
    // ordinarily ~0 below saturation) plus the round-trip hitLatencyMs —
    // not serviceTimeSeconds, which here is cpuTimeMs and would understate
    // what a client actually observes. responseQuantile() adds serviceTime
    // (cpuTimeMs) internally; swap it for hitLatencyMs by subtracting it
    // back out, rather than duplicating the quantile derivation.
    const hitLatencySeconds = component.hitLatencyMs.value / 1000;
    const meanResponseSeconds = metrics.meanWaitSeconds + hitLatencySeconds;
    const p99Seconds = p99 - serviceTimeSeconds + hitLatencySeconds;
    return {
      componentId: component.id,
      arrivalRps,
      capacityRps,
      utilization: metrics.utilization,
      meanLatencyMs: meanResponseSeconds * 1000,
      p99LatencyMs: p99Seconds * 1000,
      concurrentRequests: arrivalRps * meanResponseSeconds,
      saturated: false,
    };
  }

  return {
    componentId: component.id,
    arrivalRps,
    capacityRps,
    utilization: metrics.utilization,
    meanLatencyMs: metrics.meanResponseSeconds * 1000,
    p99LatencyMs: p99 * 1000,
    concurrentRequests: metrics.meanInSystem,
    saturated: !metrics.stable,
  };
}
