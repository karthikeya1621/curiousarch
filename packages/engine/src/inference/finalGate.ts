/**
 * One last gate on every build and Re-simulate result, before anyone sees it. The
 * individual steps each check their own output (and most silly mistakes found so far
 * were caught that way), but those checks are spread over five steps and two merges,
 * some only trigger a retry, and a result assembled from their outputs was never
 * checked as a whole. This runs every HARD rule — the ones that need no design
 * opinion to call wrong — on the finished model against the one it replaces, and
 * names each violation. A result with violations is never shown: the engine tries
 * once more with the violations spelled out, and if it still fails it throws
 * `ModelGateError`, so the caller keeps the previous version and says so.
 *
 * Deliberately NOT here: anything that is a judgment (is the CDN's origin sensible,
 * is a shared database a risk). Those are the AI's, and reviewed by people.
 */

import { isExtendedComponent } from "./extendedComponents.ts";
import { BOTH_ENDS_RULE, DEAD_END_CODES, lintTopology } from "./lintTopology.ts";
import { atLowestTier, checkLowestTierMinimal } from "./startMinimal.ts";
import { MAX_BASE_COMPONENTS, MAX_EXTENDED_COMPONENTS, type SystemModel } from "../types.ts";

export class ModelGateError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`The result broke ${violations.length} rule${violations.length === 1 ? "" : "s"}: ${violations.join("; ")}`);
    this.name = "ModelGateError";
    this.violations = violations;
  }
}

const isTrait = (v: unknown): v is { value: unknown; provenance?: unknown } => typeof v === "object" && v !== null && "value" in v;

function reachable(edges: { from: string; to: string }[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
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
}

function hasCycle(model: SystemModel): boolean {
  const next = new Map<string, string[]>();
  for (const e of model.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const n of next.get(id) ?? []) if (visit(n)) return true;
    state.set(id, 2);
    return false;
  };
  return model.components.some((c) => visit(c.id));
}

/**
 * `previous` is the model being reworked (absent on a build). `anythingAsked` is
 * true when a fix or chat change was queued — it may legitimately remove things or
 * change stated values, so those rules stand down. Returns the violations, empty when
 * the result is sound.
 */
export function checkFinalModel(result: SystemModel, ctx: { previous?: SystemModel; anythingAsked: boolean }): string[] {
  const bad: string[] = [];
  const ids = result.components.map((c) => c.id);
  const known = new Set(ids);

  // Identity
  if (!result.id.trim() || !result.name.trim()) bad.push("the project has no id or title");
  if (/[{}]/.test(result.name) || /[{}]/.test(result.id)) bad.push(`the title or id contains JSON (${JSON.stringify(result.name).slice(0, 60)})`);
  if (ctx.previous && (result.id !== ctx.previous.id || result.name !== ctx.previous.name)) bad.push("the id or title was changed");

  // Structure
  if (new Set(ids).size !== ids.length) bad.push("two components share an id");
  const pairs = new Set<string>();
  for (const e of result.edges) {
    if (!known.has(e.from) || !known.has(e.to)) bad.push(`the connection ${e.from} -> ${e.to} points at a component that does not exist`);
    if (e.from === e.to) bad.push(`${e.from} is connected to itself`);
    const key = `${e.from}\u0000${e.to}`;
    if (pairs.has(key)) bad.push(`the connection ${e.from} -> ${e.to} appears twice`);
    pairs.add(key);
  }
  if (hasCycle(result)) bad.push("the connections form a cycle");
  if (result.components.length > 1) {
    const touched = new Set(result.edges.flatMap((e) => [e.from, e.to]));
    const floating = result.components.filter((c) => !touched.has(c.id)).map((c) => c.id);
    if (floating.length > 0) bad.push(`${floating.join(", ")} ${floating.length === 1 ? "is" : "are"} not connected to anything`);
  }

  // Limits
  const extended = result.components.filter(isExtendedComponent).length;
  if (result.components.length - extended > MAX_BASE_COMPONENTS) bad.push(`more than ${MAX_BASE_COMPONENTS} base components`);
  if (extended > MAX_EXTENDED_COMPONENTS) bad.push(`more than ${MAX_EXTENDED_COMPONENTS} extended components`);

  // A CDN is reached by clients: nothing points into one.
  for (const f of lintTopology(result)) if (f.code === "CDN_BEHIND_ORIGIN") bad.push(`${f.componentId} is drawn behind a component that calls it`);

  // A queue or broker needs a producer and a consumer. One drawn with a missing end is the generator leaving the graph
  // incomplete, so it is repaired here instead of being handed to the findings review as a "risk". Only ends the result
  // introduces count: an older project that already has one must still be re-simulated (its own findings still show it).
  const deadKey = (f: { code: string; componentId: string }) => `${f.code}\u0000${f.componentId}`;
  const hadDeadEnds = new Set(ctx.previous ? lintTopology(ctx.previous).filter((f) => DEAD_END_CODES.has(f.code)).map(deadKey) : []);
  for (const f of lintTopology(result)) {
    if (DEAD_END_CODES.has(f.code) && !hadDeadEnds.has(deadKey(f))) bad.push(`${f.title} (${BOTH_ENDS_RULE})`);
  }

  // Minimal at the lowest tier: no protection on unless it is stated, and (with nothing asked) no scaling beyond the minimum.
  if (atLowestTier(result.workload)) {
    for (const c of result.components as unknown as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(c)) {
        if (/^has[A-Z]/.test(k) && isTrait(v) && v.value === true && v.provenance !== "stated") bad.push(`${String(c.id)}.${k} is on although nothing states it (the system is at its lowest tier)`);
      }
    }
    if (!ctx.anythingAsked) {
      const minimal = checkLowestTierMinimal(result.components, result.workload);
      if (minimal) bad.push("something is scaled beyond the minimum at the lowest tier");
    }
  }

  // Against the model it replaces
  const previous = ctx.previous;
  if (previous) {
    if (JSON.stringify(result.workload.users) !== JSON.stringify(previous.workload.users) || JSON.stringify(result.workload.requests) !== JSON.stringify(previous.workload.requests)) {
      bad.push("the workload settings were changed");
    }
    if (!ctx.anythingAsked) {
      const lost = previous.components.filter((c) => !known.has(c.id)).map((c) => c.id);
      if (lost.length > 0) bad.push(`${lost.join(", ")} ${lost.length === 1 ? "was" : "were"} removed although nothing asked for it`);
      const dropped = new Set<string>();
      const cdnIds = new Set(previous.components.filter((c) => c.kind === "cdn").map((c) => c.id));
      for (const e of previous.edges) {
        // An older project may have an edge INTO a CDN; turning it around is a correction, not a loss.
        if (cdnIds.has(e.to)) continue;
        if (known.has(e.from) && known.has(e.to) && !reachable(result.edges, e.from, e.to)) dropped.add(`${e.from} -> ${e.to}`);
      }
      if (dropped.size > 0) bad.push(`the connection${dropped.size === 1 ? "" : "s"} ${[...dropped].join(", ")} ${dropped.size === 1 ? "was" : "were"} lost`);
      for (const c of result.components as unknown as Record<string, unknown>[]) {
        const old = previous.components.find((p) => p.id === c.id) as unknown as Record<string, unknown> | undefined;
        if (!old) continue;
        for (const [k, v] of Object.entries(old)) {
          const now = c[k];
          if (isTrait(v) && v.provenance === "stated" && isTrait(now) && JSON.stringify(now.value) !== JSON.stringify(v.value)) {
            bad.push(`${String(c.id)}.${k} was stated by the description and changed`);
          }
        }
      }
    }
  }
  return bad;
}
