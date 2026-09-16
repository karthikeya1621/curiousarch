/**
 * Graph solver.
 *
 * Propagates load from the entry point, evaluates every component, then derives
 * findings. Findings are COMPUTED here and carry their own evidence. No text is
 * generated in this file and no LLM is involved — the copy layer may phrase a
 * finding, never place one. That boundary is the product.
 */

import {
  capacityOf,
  evaluate,
  isAsyncBoundary,
  outflowFactor,
} from "./components.ts";
import type {
  Component,
  ComponentResult,
  Finding,
  SimulationResult,
  SystemModel,
} from "./types.ts";

const HIGH_UTILIZATION = 0.8;

function topologicalOrder(model: SystemModel): Component[] {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const indegree = new Map(model.components.map((c) => [c.id, 0]));
  for (const edge of model.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = model.components.filter((c) => indegree.get(c.id) === 0);
  const ordered: Component[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    ordered.push(node);
    for (const edge of model.edges.filter((e) => e.from === node.id)) {
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(byId.get(edge.to)!);
    }
  }

  if (ordered.length !== model.components.length) {
    throw new Error(
      "Model contains a cycle. Retries and circuit breakers are modelled as " +
        "parameters, not as edges back into an upstream component.",
    );
  }
  return ordered;
}

/** Arrival rate at every component, following fan-out and cache misses. */
function propagateLoad(
  model: SystemModel,
  ordered: Component[],
): Map<string, number> {
  const arrival = new Map<string, number>();
  const entries = new Set(
    model.components
      .filter((c) => !model.edges.some((e) => e.to === c.id))
      .map((c) => c.id),
  );

  for (const component of ordered) {
    if (entries.has(component.id)) {
      arrival.set(component.id, model.workload.rps);
      continue;
    }
    let inbound = 0;
    for (const edge of model.edges.filter((e) => e.to === component.id)) {
      const upstreamArrival = arrival.get(edge.from) ?? 0;
      const source = model.components.find((c) => c.id === edge.from)!;
      inbound +=
        upstreamArrival *
        outflowFactor(source, upstreamArrival) *
        edge.callsPerRequest;
    }
    arrival.set(component.id, inbound);
  }
  return arrival;
}

/**
 * Worst-case synchronous path latency. Paths terminate at async boundaries,
 * because the caller does not wait for a queue to drain.
 */
function criticalPath(
  model: SystemModel,
  results: Map<string, ComponentResult>,
): { mean: number; p99: number } {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const memo = new Map<string, { mean: number; p99: number }>();

  function walk(id: string): { mean: number; p99: number } {
    const cached = memo.get(id);
    if (cached) return cached;

    const self = results.get(id)!;
    const component = byId.get(id)!;

    // An async boundary contributes nothing to the caller's latency: the
    // producer returns once the message is accepted. Neither the queue's own
    // drain time nor anything behind it is waited on. Counting the consumer's
    // service time here would report a 2s transcode as user-facing latency.
    if (isAsyncBoundary(component)) {
      const zero = { mean: 0, p99: 0 };
      memo.set(id, zero);
      return zero;
    }

    let best = { mean: 0, p99: 0 };
    for (const edge of model.edges.filter((e) => e.from === id)) {
      const downstream = walk(edge.to);
      if (downstream.mean > best.mean) best = downstream;
    }

    const total = {
      mean: self.meanLatencyMs + best.mean,
      p99: self.p99LatencyMs + best.p99,
    };
    memo.set(id, total);
    return total;
  }

  const entries = model.components.filter(
    (c) => !model.edges.some((e) => e.to === c.id),
  );
  let worst = { mean: 0, p99: 0 };
  for (const entry of entries) {
    const path = walk(entry.id);
    if (path.mean > worst.mean) worst = path;
  }
  return worst;
}

function deriveFindings(
  model: SystemModel,
  arrival: Map<string, number>,
  results: Map<string, ComponentResult>,
): Finding[] {
  const findings: Finding[] = [];

  for (const component of model.components) {
    const result = results.get(component.id)!;
    const load = arrival.get(component.id)!;

    if (component.kind === "gateway" && result.saturated) {
      findings.push({
        code: "GATEWAY_LIMIT_EXCEEDED",
        severity: "critical",
        componentId: component.id,
        evidence: {
          offeredRps: round(load),
          limitRps: component.maxRps.value,
          rejectedRps: round(load - component.maxRps.value),
        },
      });
      continue;
    }

    if (component.kind === "database") {
      if (result.saturated) {
        findings.push({
          code: "CONNECTION_POOL_EXHAUSTED",
          severity: "critical",
          componentId: component.id,
          evidence: {
            arrivalRps: round(load),
            poolSize: component.connectionPoolSize.value,
            queryTimeMs: component.queryTimeMs.value,
            maxSustainableRps: round(capacityOf(component)),
            // The number an engineer will sanity-check first.
            connectionsRequired: round(
              load * (component.queryTimeMs.value / 1000),
            ),
          },
        });
      }

      // Replication lag: writes arriving faster than replicas can apply them
      // means read replicas fall progressively further behind.
      const writeRps = load * component.writeRatio.value;
      const applyRate = component.replicaApplyRate.value;
      // A deficit under 1% is inside the noise of our own parameter guesses.
      // Firing on it produced findings whose evidence read "0 seconds of lag
      // per second", which reads as a bug to anyone who knows the system.
      const materialDeficit = writeRps > applyRate * 1.01;

      if (component.readReplicas.value > 0 && materialDeficit) {
        const deficit = writeRps - applyRate;
        const lagGrowth = deficit / applyRate;
        findings.push({
          code: "REPLICATION_LAG",
          // Slow drift is a warning; replicas falling behind faster than
          // real time is unrecoverable without shedding writes.
          severity: lagGrowth >= 0.1 ? "critical" : "warning",
          componentId: component.id,
          evidence: {
            writeRps: round(writeRps, 1),
            replicaApplyRate: applyRate,
            // Seconds of staleness accrued per second of runtime.
            lagGrowthSecondsPerSecond: round(lagGrowth, 3),
            // Staleness after five minutes at this rate.
            lagAfter5MinSeconds: round(lagGrowth * 300, 1),
            replicas: component.readReplicas.value,
          },
        });
      }
    }

    if (component.kind === "queue") {
      const drain = capacityOf(component);
      if (load > drain) {
        const deficit = load - drain;
        const secondsUntilFull = component.capacity.value / deficit;
        findings.push({
          code: "QUEUE_OVERFLOW",
          // A backlog that takes a day to overflow is a capacity warning an
          // on-call can absorb; one that fills within the hour is an outage.
          // Grading by time-to-impact keeps the red markers meaningful.
          severity: secondsUntilFull <= 3_600 ? "critical" : "warning",
          componentId: component.id,
          evidence: {
            arrivalRps: round(load),
            drainRps: round(drain),
            capacity: component.capacity.value,
            secondsUntilFull: round(secondsUntilFull, 1),
            backlogAfter1HourMessages: round(deficit * 3_600),
            consumersRequired: Math.ceil(
              load / (drain / component.consumers.value),
            ),
          },
        });
      }
    }

    if (component.kind === "service" && result.saturated) {
      findings.push({
        code: "SERVICE_SATURATED",
        severity: "critical",
        componentId: component.id,
        evidence: {
          arrivalRps: round(load),
          maxSustainableRps: round(capacityOf(component)),
          instances: component.instances.value,
          serviceTimeMs: component.serviceTimeMs.value,
          instancesRequired: Math.ceil(
            load /
              (capacityOf(component) / component.instances.value),
          ),
        },
      });
    }

    // A cache is still one server per shard internally (see components.ts);
    // if arrival outruns what that shard can process, evaluate() reports
    // Infinity latency exactly like any other saturated component, but had
    // no finding case here to surface it — a saturated cache read as
    // perfectly healthy. See CONTEXT.md's bug log.
    if (component.kind === "cache" && result.saturated) {
      findings.push({
        code: "CACHE_SATURATED",
        severity: "critical",
        componentId: component.id,
        evidence: {
          arrivalRps: round(load),
          maxSustainableRps: round(capacityOf(component)),
          cpuTimeMs: component.cpuTimeMs.value,
          // The per-op processing time this cache would need to keep up at
          // this load, at its current single-shard concurrency.
          requiredCpuTimeMs: round(1000 / load, 4),
        },
      });
    }

    if (
      !result.saturated &&
      result.utilization >= HIGH_UTILIZATION &&
      component.kind !== "gateway"
    ) {
      findings.push({
        code: "HIGH_UTILIZATION",
        severity: "warning",
        componentId: component.id,
        evidence: {
          utilization: round(result.utilization, 3),
          arrivalRps: round(load),
          capacityRps: round(capacityOf(component)),
          p99LatencyMs: round(result.p99LatencyMs, 1),
          // Latency is non-linear past ~80%; this is the headroom left.
          headroomRps: round(capacityOf(component) - load),
        },
      });
    }
  }

  findings.push(...herdFindings(model, arrival, results));
  return findings;
}

/**
 * Thundering herd on cache expiry.
 *
 * Two distinct numbers matter here, and an early version of this model
 * conflated them:
 *
 *   aggregate extra load = arrival * refill / ttl
 *   duplicate concurrency = (arrival / hotKeys) * refill
 *
 * The aggregate is hot-set independent — the hotKeys term cancels — so using it
 * alone made a 10-key and a 10,000-key cache look identical. That is wrong in
 * the way that matters: the damage from a herd is N identical in-flight queries
 * for ONE key, which is the second number. A cache over a 5ms primary-key
 * lookup essentially cannot herd; a cache over a 200ms aggregation herds badly
 * at the same traffic. Refill time, not TTL alone, is the driver.
 *
 * Both are steady-state averages of a bursty phenomenon. Synchronized expiry
 * (a deploy or a flush populating every key at once) is far worse than this and
 * is not modelled — noted so it can be added rather than silently assumed away.
 */
function herdFindings(
  model: SystemModel,
  arrival: Map<string, number>,
  results: Map<string, ComponentResult>,
): Finding[] {
  const findings: Finding[] = [];

  for (const component of model.components) {
    if (component.kind !== "cache") continue;

    const load = arrival.get(component.id)!;
    const downstream = model.edges
      .filter((e) => e.from === component.id)
      .map((e) => model.components.find((c) => c.id === e.to)!)
      .find((c) => c.kind === "database");
    if (!downstream || downstream.kind !== "database") continue;

    const refillSeconds = downstream.queryTimeMs.value / 1000;
    const hotKeys = component.keyspaceHotSet.value;
    const perKeyRps = hotKeys > 0 ? load / hotKeys : 0;

    // Identical queries in flight for a single key while it refills.
    const duplicatesPerExpiry = perKeyRps * refillSeconds;
    const herdRps = (load * refillSeconds) / component.ttlSeconds.value;
    const steadyMissRps = load * (1 - component.hitRate.value);
    const originCapacity = capacityOf(downstream);
    const originResult = results.get(downstream.id)!;

    const pushesOriginOver =
      !originResult.saturated && steadyMissRps + herdRps > originCapacity;
    // Below ~2 duplicates there is no herd worth naming, however short the TTL.
    const duplicationIsReal = duplicatesPerExpiry >= 2;

    if (pushesOriginOver || duplicationIsReal) {
      findings.push({
        code: "THUNDERING_HERD",
        severity: pushesOriginOver ? "critical" : "warning",
        componentId: component.id,
        evidence: {
          ttlSeconds: component.ttlSeconds.value,
          hotKeys,
          refillMs: downstream.queryTimeMs.value,
          duplicateQueriesPerExpiry: round(duplicatesPerExpiry, 1),
          expiriesPerSecond: round(hotKeys / component.ttlSeconds.value, 1),
          steadyMissRps: round(steadyMissRps),
          herdAddedRps: round(herdRps),
          originCapacityRps: round(originCapacity),
          originId: downstream.id,
        },
      });
    }
  }
  return findings;
}

function round(value: number, dp = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export function simulate(model: SystemModel): SimulationResult {
  const ordered = topologicalOrder(model);
  const arrival = propagateLoad(model, ordered);

  const results = new Map<string, ComponentResult>();
  for (const component of ordered) {
    results.set(component.id, evaluate(component, arrival.get(component.id)!));
  }

  const findings = deriveFindings(model, arrival, results);
  const path = criticalPath(model, results);

  return {
    modelId: model.id,
    workload: model.workload,
    components: ordered.map((c) => results.get(c.id)!),
    findings,
    endToEndMeanMs: path.mean,
    endToEndP99Ms: path.p99,
    healthy: !findings.some((f) => f.severity === "critical"),
  };
}

/**
 * Sweep load to find where the system first breaks. This is what drives the
 * constraint sliders: the user does not ask "is 50k RPS fine", they ask "where
 * does this fall over".
 */
export function findBreakingPoint(
  model: SystemModel,
  maxRps = 1_000_000,
): { rps: number; findings: Finding[] } | null {
  let low = 1;
  let high = maxRps;

  if (simulate({ ...model, workload: { ...model.workload, rps: low } }).healthy === false) {
    return { rps: low, findings: simulate({ ...model, workload: { ...model.workload, rps: low } }).findings };
  }
  if (simulate({ ...model, workload: { ...model.workload, rps: high } }).healthy) {
    return null;
  }

  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const result = simulate({ ...model, workload: { ...model.workload, rps: mid } });
    if (result.healthy) low = mid;
    else high = mid;
  }

  const breaking = simulate({ ...model, workload: { ...model.workload, rps: high } });
  return { rps: high, findings: breaking.findings };
}
