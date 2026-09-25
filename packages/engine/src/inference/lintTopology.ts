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

const ASYNC_KINDS = new Set<string>(["queue", "message-broker"]);

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
      (mid) => mid !== e.to && ASYNC_KINDS.has(byId.get(mid)?.kind ?? "") && (out.get(mid) ?? []).includes(e.to),
    );
    if (via === undefined) continue;
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

  return findings;
}

/** AI findings first; lint findings the AI didn't already raise (same code on the same component) after them. */
export function mergeLintFindings(ai: AiFinding[], lint: AiFinding[]): AiFinding[] {
  const have = new Set(ai.map((f) => `${f.code}\u0000${f.componentId}`));
  return [...ai, ...lint.filter((f) => !have.has(`${f.code}\u0000${f.componentId}`))];
}

/**
 * Also collapses duplicate edges. Removes the direct edge in a parallel sync + async pair (A -> B alongside
 * A -> queue/broker -> B), keeping the buffered path. The base call and the
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
  return unique.filter((e) => {
    const buffered = (out.get(e.from) ?? []).some(
      (mid) => mid !== e.to && ASYNC_KINDS.has(kindOf.get(mid) ?? "") && (out.get(mid) ?? []).includes(e.to),
    );
    // The direct edge is redundant only when it is not itself the queue leg.
    return !(buffered && !ASYNC_KINDS.has(kindOf.get(e.to) ?? ""));
  });
}
