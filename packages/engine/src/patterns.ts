/**
 * The architectural pattern catalogue — this is the engine now.
 *
 * Findings are COMPUTED here, from rough categorical properties and
 * topology shape, never simulated from a magnitude an LLM had to guess.
 * Each pattern is a pure, named, testable predicate — same standard
 * `solver.ts`'s old `deriveFindings` held itself to, just over traits
 * instead of formulas. No text is generated here and no LLM is involved;
 * the copy layer may phrase a finding, never place one.
 *
 * Six patterns, not fifty: each one is real, well-known architectural
 * wisdom that earns its place, not padding for coverage.
 */

import { isAsyncBoundary } from "./components.ts";
import type { Component, Finding, SystemModel } from "./types.ts";

function isLoadBearing(model: SystemModel, componentId: string): boolean {
  return model.edges.some((e) => e.to === componentId);
}

/**
 * A single instance of anything on the request path means "it crashed"
 * turns directly into "nothing noticed" becomes false. Kind-aware evidence:
 * a database losing its only copy is a data-loss risk, not just downtime.
 */
function singlePointOfFailure(model: SystemModel): Finding[] {
  const findings: Finding[] = [];
  for (const component of model.components) {
    if (!isLoadBearing(model, component.id)) continue;

    if (component.kind === "service" && component.instanceCount.value === "single") {
      findings.push({
        code: "SINGLE_POINT_OF_FAILURE",
        severity: "critical",
        componentId: component.id,
        evidence: {
          reason: "Only one instance — a crash or a bad deploy takes this offline with nothing to absorb it.",
          instanceCount: "single",
        },
      });
    }

    if (component.kind === "database" && component.instanceCount.value === "single") {
      const writeHeavy = component.writeVolume.value === "high";
      findings.push({
        code: "SINGLE_POINT_OF_FAILURE",
        severity: "critical",
        componentId: component.id,
        evidence: writeHeavy
          ? {
              reason: "No replica, and write volume is high — losing this instance loses data, not just uptime.",
              instanceCount: "single",
              writeVolume: "high",
            }
          : {
              reason: "No replica — a crash or maintenance window takes this offline with no failover.",
              instanceCount: "single",
            },
      });
    }
  }
  return findings;
}

/**
 * The worst-case coincidence: few enough hot keys that they expire in
 * lockstep, a short enough TTL that they expire often, and nothing coalescing
 * the resulting duplicate refills into one request.
 */
function thunderingHerdRisk(model: SystemModel): Finding[] {
  const findings: Finding[] = [];
  for (const component of model.components) {
    if (component.kind !== "cache") continue;
    if (
      component.ttl.value === "short" &&
      component.keyspaceSize.value === "small" &&
      !component.hasStampedeProtection.value
    ) {
      findings.push({
        code: "THUNDERING_HERD_RISK",
        severity: "critical",
        componentId: component.id,
        evidence: {
          reason: "Short TTL over a small hot keyspace, with nothing coalescing duplicate refills — every expiry sends a burst of identical requests downstream at once.",
          ttl: "short",
          keyspaceSize: "small",
          hasStampedeProtection: "false",
        },
      });
    }
  }
  return findings;
}

/**
 * Every synchronous root-to-leaf path (stopping at a queue — the caller
 * doesn't wait for one to drain). A partial path that runs into a queue is
 * dropped entirely, not truncated-and-kept: nothing past an async boundary
 * is on anyone's live synchronous request path, so it's not a candidate
 * chain for either consumer below. Shared by `cascadingFailureRisk` (long
 * chains with no circuit breaker) and `uncachedDatabaseAtScale` (a
 * database at the tail of one of these with no cache anywhere upstream) —
 * the "is this really a live synchronous path" question is identical for
 * both.
 */
function synchronousChains(model: SystemModel): Component[][] {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const entries = model.components.filter((c) => !isLoadBearing(model, c.id));
  const chains: Component[][] = [];

  function walk(componentId: string, chain: Component[]) {
    const component = byId.get(componentId)!;
    if (isAsyncBoundary(component)) return; // nothing downstream waits synchronously
    const extended = [...chain, component];
    const outgoing = model.edges.filter((e) => e.from === componentId);
    if (outgoing.length === 0) {
      chains.push(extended);
      return;
    }
    for (const edge of outgoing) walk(edge.to, extended);
  }

  for (const entry of entries) walk(entry.id, []);
  return chains;
}

/**
 * Every synchronous chain (see `synchronousChains`) of length >= 3 with no
 * circuit breaker anywhere in it: a slow leaf's latency (or failure)
 * propagates all the way back up the chain with nothing to stop it.
 */
function cascadingFailureRisk(model: SystemModel): Finding[] {
  const chains = synchronousChains(model);
  const flagged = new Set<string>();
  const findings: Finding[] = [];
  for (const chain of chains) {
    if (chain.length < 3) continue;
    const hasBreaker = chain.some(
      (c) => c.kind === "service" && c.hasCircuitBreaker.value === true,
    );
    if (hasBreaker) continue;
    const tail = chain[chain.length - 1]!;
    if (flagged.has(tail.id)) continue;
    flagged.add(tail.id);
    findings.push({
      code: "CASCADING_FAILURE_RISK",
      severity: "critical",
      componentId: tail.id,
      evidence: {
        reason: `A ${chain.length}-deep synchronous chain (${chain.map((c) => c.id).join(" -> ")}) with no circuit breaker anywhere in it — this component being slow or down stalls every caller above it.`,
        chainLength: String(chain.length),
        hasCircuitBreaker: "false",
      },
    });
  }
  return findings;
}

/** Nothing sheds load before it overwhelms whatever is downstream. */
function unboundedAdmission(model: SystemModel): Finding[] {
  const findings: Finding[] = [];
  for (const component of model.components) {
    if (component.kind !== "gateway") continue;
    if (!component.hasRateLimiting.value) {
      findings.push({
        code: "UNBOUNDED_ADMISSION",
        severity: "warning",
        componentId: component.id,
        evidence: {
          reason: "No rate limiting at the entry point — a spike passes straight through to whatever is downstream, uncapped.",
          hasRateLimiting: "false",
        },
      });
    }
  }
  return findings;
}

/** Without one, a single poison message blocks the pipeline forever. */
function queueNoDeadLetter(model: SystemModel): Finding[] {
  const findings: Finding[] = [];
  for (const component of model.components) {
    if (component.kind !== "queue") continue;
    if (!component.hasDeadLetterQueue.value) {
      findings.push({
        code: "QUEUE_NO_DEAD_LETTER",
        severity: "warning",
        componentId: component.id,
        evidence: {
          reason: "No dead-letter queue — one message that always fails to process blocks everything behind it instead of being set aside.",
          hasDeadLetterQueue: "false",
        },
      });
    }
  }
  return findings;
}

/** A fixed worker pool can't absorb a burst once the system is operating at real scale. */
function fixedScalingAtScale(model: SystemModel): Finding[] {
  const findings: Finding[] = [];
  const scale = model.workload.scale.value;
  if (scale !== "large" && scale !== "massive") return findings;
  for (const component of model.components) {
    if (component.kind !== "queue") continue;
    if (component.consumerScaling.value === "fixed") {
      findings.push({
        code: "FIXED_SCALING_AT_SCALE",
        severity: "warning",
        componentId: component.id,
        evidence: {
          reason: `A fixed consumer pool at ${scale} scale — a traffic burst has no way to be absorbed by adding workers.`,
          consumerScaling: "fixed",
          scale,
        },
      });
    }
  }
  return findings;
}

/**
 * A read-heavy database (write volume low — reads dominate) sitting
 * directly on a live synchronous request path with nothing absorbing
 * repeat reads before they reach it. Gated on scale the same way
 * `fixedScalingAtScale` is — a handful of direct reads is fine; this is
 * specifically about a hot path that's outgrown going direct. Unlike every
 * other pattern here, its real fix isn't a trait flip — it's inserting a
 * cache, which `fixes.ts` does structurally for this one code.
 */
function uncachedDatabaseAtScale(model: SystemModel): Finding[] {
  const scale = model.workload.scale.value;
  if (scale !== "large" && scale !== "massive") return [];

  const flagged = new Set<string>();
  const findings: Finding[] = [];
  for (const chain of synchronousChains(model)) {
    const tail = chain[chain.length - 1];
    if (!tail || tail.kind !== "database") continue;
    if (tail.writeVolume.value !== "low") continue;
    if (chain.some((c) => c.kind === "cache")) continue;
    if (flagged.has(tail.id)) continue;
    flagged.add(tail.id);
    findings.push({
      code: "UNCACHED_DATABASE_AT_SCALE",
      severity: "warning",
      componentId: tail.id,
      evidence: {
        reason: `A read-heavy database sits directly on a synchronous request path (${chain.map((c) => c.id).join(" -> ")}) at ${scale} scale with nothing absorbing repeat reads before they reach it.`,
        writeVolume: "low",
        scale,
      },
    });
  }
  return findings;
}

const PATTERNS = [
  singlePointOfFailure,
  thunderingHerdRisk,
  cascadingFailureRisk,
  unboundedAdmission,
  queueNoDeadLetter,
  fixedScalingAtScale,
  uncachedDatabaseAtScale,
];

export function evaluatePatterns(model: SystemModel): Finding[] {
  return PATTERNS.flatMap((pattern) => pattern(model));
}
