/**
 * Deterministic topology checks that run beside the AI review, in code, for
 * free. Found on a real project: the model contained a service reaching
 * another both directly and through a queue — visible in the graph itself —
 * and the AI review still reported nothing. A shape problem that can be read
 * off the edges shouldn't depend on the model noticing it.
 *
 * Each finding has the same shape an AI finding does (including at least one
 * fix, worded so Re-simulate can implement it as-is), so it flows through the
 * same UI, queueing and fixed/queued bookkeeping. Deliberately few rules:
 * only ones that are unambiguously wrong from the graph alone. Anything that
 * needs judgment about the system's domain stays with the AI review.
 */

import type { AiFinding, SystemModel } from "../types.ts";

/**
 * A queue or broker drawn with only one end is an incomplete diagram, not a design risk: nothing about the system can
 * be judged from it. Said to every step that draws one (prompts), and enforced on the finished model (finalGate.ts).
 */
export const BOTH_ENDS_RULE = `Every queue and every message broker has both ends drawn: something that writes to it and at least one component that reads from it (an edge out of it to each consumer or subscriber). A queue nothing consumes is an incomplete diagram, not a risk to report. That includes a dead-letter queue: draw the component that reprocesses or inspects its messages, or leave the dead-letter queue out.`;

/** The lint findings that mean the graph is incomplete (see BOTH_ENDS_RULE), not that the design has a weakness. */
export const DEAD_END_CODES: ReadonlySet<string> = new Set(["QUEUE_NO_CONSUMER", "QUEUE_NO_PRODUCER", "BROKER_NO_SUBSCRIBER", "BROKER_NO_PUBLISHER"]);

const ASYNC_KINDS = new Set<string>(["queue", "message-broker"]);
/** A component traffic passes THROUGH: a direct edge around it is redundant. */
const PASS_THROUGH_KINDS = new Set<string>([...ASYNC_KINDS, "load-balancer"]);
/** Kinds that call a service on the request path — the ones a load balancer sits in front of. */
const CALLER_KINDS = new Set<string>(["gateway", "service"]);

export function lintTopology(model: Pick<SystemModel, "components" | "edges">): AiFinding[] {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of model.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  }
  const findings: AiFinding[] = [];

  // Two competing paths: A -> B directly AND A -> queue/broker -> B. Whether
  // the work is synchronous or buffered can't be both.
  const seenPairs = new Set<string>();
  for (const e of model.edges) {
    const pair = `${e.from}\u0000${e.to}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const via = (out.get(e.from) ?? []).find(
      (mid) => mid !== e.to && PASS_THROUGH_KINDS.has(byId.get(mid)?.kind ?? "") && (out.get(mid) ?? []).includes(e.to),
    );
    if (via === undefined) continue;
    if (byId.get(via)?.kind === "load-balancer") {
      findings.push({
        code: "PATH_AROUND_LOAD_BALANCER",
        severity: "warning",
        componentId: e.to,
        title: `${label(e.from)} reaches ${label(e.to)} both directly and through ${label(via)}`,
        explanation: `Traffic can go straight to ${label(e.to)} or through the load balancer ${label(via)}. Requests that skip the load balancer get no health checks or spreading across instances, and the diagram doesn't say which path is the real one.`,
        fixes: [
          {
            id: "remove-direct-path",
            label: `Remove the direct connection from "${e.from}" to "${e.to}" so traffic only reaches it through the load balancer "${via}"`,
            tradeoff: `Everything then depends on the load balancer, which becomes a component that must itself be kept highly available.`,
          },
        ],
      });
      continue;
    }
    findings.push({
      code: "PARALLEL_SYNC_AND_ASYNC_PATH",
      severity: "warning",
      componentId: e.to,
      title: `${label(e.from)} reaches ${label(e.to)} both directly and through ${label(via)}`,
      explanation: `The diagram sends the same work two ways: straight to ${label(e.to)} and via ${label(via)}. Requests can skip the buffer, so the queue can't protect ${label(e.to)} from a burst, and it's unclear which path is the real one.`,
      fixes: [
        {
          id: "remove-direct-path",
          label: `Remove the direct connection from "${e.from}" to "${e.to}" so this work only flows through "${via}"`,
          tradeoff: `Everything on this path becomes asynchronous, so callers no longer get an immediate answer from ${label(e.to)}.`,
        },
      ],
    });
  }

  // A load balancer belongs BETWEEN its callers and what it balances: a
  // gateway or service that calls a balanced component directly, without going
  // through the balancer that fronts it, bypasses it.
  const seenBypass = new Set<string>();
  for (const e of model.edges) {
    const from = byId.get(e.from);
    if (!from || !CALLER_KINDS.has(from.kind)) continue;
    const lb = (into.get(e.to) ?? []).find((id) => id !== e.from && byId.get(id)?.kind === "load-balancer");
    if (lb === undefined || (out.get(e.from) ?? []).includes(lb)) continue; // (a direct edge alongside X -> LB -> S is reported above)
    const key = `${e.from}\u0000${e.to}`;
    if (seenBypass.has(key)) continue;
    seenBypass.add(key);
    findings.push({
      code: "PATH_AROUND_LOAD_BALANCER",
      severity: "warning",
      componentId: e.to,
      title: `${label(e.from)} calls ${label(e.to)} directly, bypassing ${label(lb)}`,
      explanation: `${label(lb)} is meant to spread traffic across ${label(e.to)}, but ${label(e.from)} reaches it without going through the load balancer, so that traffic gets no spreading or health checks.`,
      fixes: [
        {
          id: "route-through-load-balancer",
          label: `Route "${e.from}" through the load balancer "${lb}" instead of calling "${e.to}" directly (edge from "${e.from}" to "${lb}")`,
          tradeoff: "All of that traffic now depends on the load balancer, which must itself be kept highly available.",
        },
      ],
    });
  }

  // A CDN is reached by clients and pulls from its origin, so it is never
  // the target of another component's edge. An edge INTO one is backwards.
  const cdnIds = new Set(model.components.filter((c) => c.kind === "cdn").map((c) => c.id));
  const seenCdn = new Set<string>();
  for (const e of model.edges) {
    if (!cdnIds.has(e.to) || cdnIds.has(e.from)) continue;
    const key = `${e.from}\u0000${e.to}`;
    if (seenCdn.has(key)) continue;
    seenCdn.add(key);
    findings.push({
      code: "CDN_BEHIND_ORIGIN",
      severity: "warning",
      componentId: e.to,
      title: `${label(e.from)} is drawn calling ${label(e.to)}, but the CDN should sit in front`,
      explanation: `Clients hit a CDN first and it pulls from the origin, not the other way round. Drawn backwards, the CDN looks like something ${label(e.from)} depends on, which hides the real risk: a busy or cold CDN sending every request to ${label(e.from)}.`,
      fixes: [
        {
          id: "reverse-cdn-edge",
          label: `Reverse the connection between "${e.from}" and "${e.to}" so clients reach the CDN "${e.to}" first and it pulls from "${e.from}" (edge from "${e.to}" to "${e.from}")`,
          tradeoff: "Only changes how the diagram reads; the CDN then shows as the first stop for client traffic and its cache misses land on the origin.",
        },
      ],
    });
  }

  // A queue nothing reads from (messages pile up forever) or nothing writes to.
  for (const c of model.components) {
    if (c.kind !== "queue") continue;
    if (!(out.get(c.id) ?? []).length) {
      findings.push({
        code: "QUEUE_NO_CONSUMER",
        severity: "critical",
        componentId: c.id,
        title: `${c.label} has no consumer`,
        explanation: `Nothing reads from ${c.label}, so every message put on it just piles up and the work it carries never happens.`,
        fixes: [
          {
            id: "add-consumer",
            label: `Connect the service that should process messages from "${c.id}" to it as its consumer`,
            tradeoff: "Adds a consuming service, and the queue's depth and processing lag now need watching.",
          },
        ],
      });
    } else if (!(into.get(c.id) ?? []).length) {
      findings.push({
        code: "QUEUE_NO_PRODUCER",
        severity: "warning",
        componentId: c.id,
        title: `${c.label} has no producer`,
        explanation: `Nothing writes to ${c.label}, so it never carries any work and its consumer sits idle.`,
        fixes: [
          {
            id: "add-producer",
            label: `Connect the service that should publish to "${c.id}" to it as its producer, or remove the queue`,
            tradeoff: "Either wires in one more dependency or removes a component you may have wanted for later.",
          },
        ],
      });
    }
  }

  // A pub/sub broker with nobody subscribed (events are published to no one), or nobody publishing.
  // Found live: a description that fanned match events out to analytics, anti-cheat and
  // notification subscribers came back with a broker that only had a publisher.
  for (const c of model.components) {
    if (c.kind !== "message-broker") continue;
    if (!(out.get(c.id) ?? []).length) {
      findings.push({
        code: "BROKER_NO_SUBSCRIBER",
        severity: "warning",
        componentId: c.id,
        title: `${c.label} has no subscribers`,
        explanation: `Nothing subscribes to ${c.label}, so the events published to it reach no one and whatever was meant to react to them never runs.`,
        fixes: [
          {
            id: "add-subscriber",
            label: `Connect the service or services that should subscribe to "${c.id}" (edges from "${c.id}" to each subscriber)`,
            tradeoff: "Adds the subscribing components, each of which now depends on the broker and needs its own failure handling.",
          },
        ],
      });
    } else if (!(into.get(c.id) ?? []).length) {
      findings.push({
        code: "BROKER_NO_PUBLISHER",
        severity: "warning",
        componentId: c.id,
        title: `${c.label} has no publisher`,
        explanation: `Nothing publishes to ${c.label}, so it never carries any events and its subscribers sit idle.`,
        fixes: [
          {
            id: "add-publisher",
            label: `Connect the service that should publish to "${c.id}" to it, or remove the broker`,
            tradeoff: "Either wires in one more dependency or removes a component you may have wanted for later.",
          },
        ],
      });
    }
  }

  return findings;
}

/** Each from/to pair once, first occurrence kept. */
export function dedupeEdges<E extends { from: string; to: string }>(edges: E[]): E[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** AI findings first; lint findings the AI didn't already raise (same code on the same component) after them. */
export function mergeLintFindings(ai: AiFinding[], lint: AiFinding[]): AiFinding[] {
  const have = new Set(ai.map((f) => `${f.code}\u0000${f.componentId}`));
  return [...ai, ...lint.filter((f) => !have.has(`${f.code}\u0000${f.componentId}`))];
}

/**
 * Also collapses duplicate edges. Removes the direct edge in a parallel pair (A -> B alongside
 * A -> queue/broker/load-balancer -> B), keeping the path through the intermediary (a load
 * balancer is inserted by the extended step, which the base call never sees, so its
 * gateway -> service edge survived next to gateway -> LB -> service: seen in the app). The base call and the
 * extended-components call run separately, so a fresh build can wire "upload ->
 * transcoder" in one and add "upload -> broker -> transcoder" in the other:
 * seen in 2 of 3 live builds of the same video-site description. The pair can't
 * both be right, and the buffered path is the one a queue is added for, so the
 * direct edge goes. Run on every build and Re-simulate result; the lint rule
 * (`PARALLEL_SYNC_AND_ASYNC_PATH`) stays as the backstop for older projects.
 */
export function collapseParallelAsyncPaths<E extends { from: string; to: string }>(
  components: { id: string; kind: string }[],
  edges: E[],
  /**
   * The load balancers this may route callers through: those NEW in this
   * result (a build's, or one this Re-simulate just added). A balancer that was
   * already there is left exactly as the user has it — someone who wants
   * internal calls to reach a service directly must be able to say so and have
   * it stay. Omitted: every balancer.
   */
  routableBalancers?: ReadonlySet<string>,
): E[] {
  // Each from/to pair once too: the base and the extended call can both emit
  // the same edge, and the merged list is where the two meet (seen live: a
  // duplicate `matching-service -> notification-service` after a Re-simulate).
  const seenPair = new Set<string>();
  const unique = edges.filter((e) => {
    const key = `${e.from}\u0000${e.to}`;
    if (seenPair.has(key)) return false;
    seenPair.add(key);
    return true;
  });
  const kindOf = new Map(components.map((c) => [c.id, c.kind]));
  const out = new Map<string, string[]>();
  for (const e of unique) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const passesThrough = (id: string) => {
    const kind = kindOf.get(id) ?? "";
    return ASYNC_KINDS.has(kind) || (kind === "load-balancer" && (routableBalancers?.has(id) ?? true));
  };
  const collapsed = unique.filter((e) => {
    const buffered = (out.get(e.from) ?? []).some(
      (mid) => mid !== e.to && passesThrough(mid) && (out.get(mid) ?? []).includes(e.to),
    );
    // The direct edge is redundant only when it is not itself the pass-through leg.
    return !(buffered && !PASS_THROUGH_KINDS.has(kindOf.get(e.to) ?? ""));
  });
  return routeThroughLoadBalancers(kindOf, collapsed, routableBalancers);
}


/**
 * A load balancer sits BETWEEN its callers and what it balances: if L -> S
 * exists, every gateway or service that calls S calls it through L. A caller
 * with a direct edge X -> S is rewired to X -> L (or, when X -> L already
 * exists, the redundant direct edge is just dropped). Only gateways and
 * services are rewired — a queue or a scheduled job reaching S is not a request
 * that a balancer spreads — and never when it would close a cycle. Product rule:
 * "if there's a load balancer, it should be in between."
 */
function routeThroughLoadBalancers<E extends { from: string; to: string }>(
  kindOf: Map<string, string>,
  edges: E[],
  routable?: ReadonlySet<string>,
): E[] {
  const front = new Map<string, string>(); // balanced component -> the balancer in front of it
  for (const e of edges) {
    if (routable && !routable.has(e.from)) continue;
    if (kindOf.get(e.from) === "load-balancer" && kindOf.get(e.to) !== "load-balancer" && !front.has(e.to)) front.set(e.to, e.from);
  }
  if (front.size === 0) return edges;

  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const reachable = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(next.get(from) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return false;
  };

  const seen = new Set<string>();
  const out: E[] = [];
  for (const e of edges) {
    const lb = front.get(e.to);
    const rewire = lb !== undefined && e.from !== lb && CALLER_KINDS.has(kindOf.get(e.from) ?? "") && !reachable(lb, e.from);
    const edge = rewire ? { ...e, to: lb! } : e;
    const key = `${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

/**
 * The balancers `collapseParallelAsyncPaths` may route callers through: the
 * ones NEW in this result. Product rule: a load balancer sits between its
 * callers and what it balances — as the default for a balancer being added; one
 * already in the system is the user's to keep, so an edit made in chat (a
 * caller that should go direct) sticks on every later Re-simulate. Decided from
 * the structure, not from the wording of a request.
 */
export function routableLoadBalancers(
  input: { components: { id: string; kind: string }[] },
  result: { components: { id: string; kind: string }[] },
): Set<string> {
  const existing = new Set(input.components.filter((c) => c.kind === "load-balancer").map((c) => c.id));
  return new Set(result.components.filter((c) => c.kind === "load-balancer" && !existing.has(c.id)).map((c) => c.id));
}
