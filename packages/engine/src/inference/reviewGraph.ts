/**
 * A final look at the wiring of the MERGED diagram, by the AI. A build (and a
 * Re-simulate) assembles its graph from two calls that cannot see each other's
 * half — the base call draws gateway -> service, the extended call inserts a
 * load balancer or a queue — so the result can contradict itself: a direct edge
 * beside a path through a balancer, a CDN drawn behind its origin. Those used to
 * be fixed by hard-coded rewrites (`collapseParallelAsyncPaths`); this asks the
 * AI to make the judgement instead, seeing the whole graph AND the user's
 * request (so "keep the admin calls direct" is respected), and returns edge
 * edits that code only VALIDATES: ids exist, no cycle, nothing orphaned.
 *
 * It is small (no components in or out) and runs only when a new queue, broker or
 * load balancer was added. It is never allowed to fail a build or a
 * Re-simulate: on any error the caller falls back to the deterministic rewrites.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import type { Edge } from "../types.ts";

const MAX_EDITS = 8;

const EditSchema = z.object({
  action: z.enum(["remove", "reverse", "add"]),
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string().min(1),
});
const ReviewSchema = z.object({ edits: z.array(EditSchema) });
export type GraphEdit = z.infer<typeof EditSchema>;

/** Kinds that give the graph something to review: an intermediary traffic passes through. (A CDN's direction is settled deterministically when the components are merged; the review call kept misreading it, so it is left out.) */
const REVIEWABLE_KINDS = new Set(["queue", "message-broker", "load-balancer"]);

const TOOL_NAME = "emit_graph_edits";

const REVIEW_PROMPT = `You are checking the wiring of an architecture diagram that was assembled by two separate steps which could not see each other's work, so it may contradict itself. An edge means "caller -> callee" (the first component calls or sends traffic to the second).

Look for these contradictions and fix each with the fewest edits:
- A component reached BOTH directly and through an intermediary that traffic passes through (a queue, a message broker or a load balancer): the direct edge is redundant - remove it.
- A load balancer sits BETWEEN its callers and what it balances. For a load balancer listed in "newComponentIds", every gateway or service that calls a component it balances directly should call the balancer instead: remove that direct edge and add caller -> balancer if it is missing. A load balancer that is NOT listed as new was already there and is left exactly as it is.
- Anything else that is plainly contradictory about direction or duplication.

Read the direction of every edge carefully before editing: most diagrams are already right, and an edge from a load balancer TO the component it balances is CORRECT - do not reverse or remove it. Leave every CDN edge exactly as it is. A load balancer that is the first hop in front of a gateway (load balancer -> gateway) is fine as it is.

Do NOT change design choices: never add or remove components, leave every edge that is not contradictory alone, and respect the user's own "request" text - if it asks for a call to stay direct or to be wired some way, that wins. If the wiring is fine, return an empty list of edits.

Output only the structured edits.`;

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(ReviewSchema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit the edge edits that fix contradictions in the diagram's wiring (an empty list when it is fine).",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

/**
 * Applies the edits and checks the result is still a sound graph. Returns the
 * new edges, or a `problem` (shown to the AI so it can repair its answer).
 */
export function applyGraphEdits(
  components: { id: string; kind?: string }[],
  edges: Edge[],
  edits: GraphEdit[],
): { edges: Edge[]; problem: string | null } {
  if (edits.length > MAX_EDITS) return { edges, problem: `At most ${MAX_EDITS} edits are allowed; you gave ${edits.length}. Fix only what is clearly contradictory.` };
  const ids = new Set(components.map((c) => c.id));
  let current = edges.map((e) => ({ ...e }));
  const has = (from: string, to: string) => current.some((e) => e.from === from && e.to === to);

  for (const edit of edits) {
    const { action, from, to } = edit;
    if (!ids.has(from) || !ids.has(to)) return { edges, problem: `"${from}" -> "${to}": both ends must be existing component ids.` };
    if (from === to) return { edges, problem: `"${from}" -> "${to}": an edge cannot join a component to itself.` };
    if (action === "remove") {
      if (!has(from, to)) return { edges, problem: `Cannot remove "${from}" -> "${to}": there is no such edge.` };
      current = current.filter((e) => !(e.from === from && e.to === to));
    } else if (action === "add") {
      if (has(from, to)) return { edges, problem: `Cannot add "${from}" -> "${to}": it already exists.` };
      current.push({ from, to });
    } else {
      if (!has(from, to)) return { edges, problem: `Cannot reverse "${from}" -> "${to}": there is no such edge.` };
      if (has(to, from)) return { edges, problem: `Cannot reverse "${from}" -> "${to}": "${to}" -> "${from}" already exists.` };
      current = current.filter((e) => !(e.from === from && e.to === to));
      current.push({ from: to, to: from });
    }
  }

  // Still acyclic.
  const next = new Map<string, string[]>();
  for (const e of current) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const cyclic = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const n of next.get(id) ?? []) if (cyclic(n)) return true;
    state.set(id, 2);
    return false;
  };
  if ([...ids].some((id) => cyclic(id))) return { edges, problem: "Those edits create a cycle; the diagram must stay acyclic." };

  // A CDN is reached by clients and pulls from its origin: nothing points INTO one.
  const kindById = new Map(components.map((c) => [c.id, (c as { kind?: string }).kind]));
  const intoCdn = current.find((e) => kindById.get(e.to) === "cdn" && kindById.get(e.from) !== "cdn");
  if (intoCdn && !edges.some((e) => e.from === intoCdn.from && e.to === intoCdn.to)) {
    return { edges, problem: `"${intoCdn.from}" -> "${intoCdn.to}": an edge INTO a CDN is backwards - a CDN calls its origin, so the edge must run from the CDN.` };
  }

  // A removed edge's connection must survive by another path: an edit that
  // merely deletes a connection is not a fix for a redundant one.
  const reach = (from: string, to: string): boolean => {
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
  for (const edit of edits) {
    if (edit.action === "remove" && !reach(edit.from, edit.to)) {
      return { edges, problem: `Removing "${edit.from}" -> "${edit.to}" would disconnect them: only remove an edge that another path makes redundant.` };
    }
  }

  // Nothing left floating that was connected before.
  const touched = (list: Edge[]) => new Set(list.flatMap((e) => [e.from, e.to]));
  const before = touched(edges);
  const after = touched(current);
  const orphaned = [...before].filter((id) => ids.has(id) && !after.has(id));
  if (orphaned.length > 0) return { edges, problem: `Those edits leave ${orphaned.map((id) => `"${id}"`).join(", ")} with no edges at all; every component must stay connected.` };

  return { edges: current, problem: null };
}

export interface ReviewGraphResult {
  edges: Edge[];
  /** True when the AI reviewed the graph (even if it changed nothing); false when it was skipped or failed — the caller then uses the deterministic rewrites. */
  reviewed: boolean;
  edits: GraphEdit[];
}

export async function reviewGraph(
  components: { id: string; kind: string; label?: string }[],
  edges: Edge[],
  context: { newComponentIds: string[]; request: string },
  options: StructuredCallOptions = {},
): Promise<ReviewGraphResult> {
  // Only when something NEW that traffic passes through was added: a queue, broker
  // or load balancer that was already there was wired by an earlier pass (and by the
  // user's own edits), and in live runs a review with nothing new either changed
  // nothing or proposed invalid edits, at a cost per Re-simulate.
  const fresh = new Set(context.newComponentIds);
  if (!components.some((c) => REVIEWABLE_KINDS.has(c.kind) && fresh.has(c.id))) return { edges, reviewed: false, edits: [] };
  try {
    const result = await runStructuredCall(
      REVIEW_PROMPT,
      JSON.stringify({
        components: components.map((c) => ({ id: c.id, kind: c.kind, label: c.label })),
        edges,
        newComponentIds: context.newComponentIds,
        request: context.request,
      }),
      ReviewSchema,
      buildTool(),
      {
        // The main model, not the small utility one: a live run with the small model
        // misread edge direction twice in one review (it proposed removing a load
        // balancer's edge to the gateway and reversing a CDN's CORRECT edge to its origin).
        maxRetries: 1,
        ...options,
        validateResult: (data) => applyGraphEdits(components, edges, (data as { edits: GraphEdit[] }).edits).problem,
      },
      "reviewGraph",
    );
    const applied = applyGraphEdits(components, edges, result.data.edits);
    return applied.problem ? { edges, reviewed: false, edits: [] } : { edges: applied.edges, reviewed: true, edits: result.data.edits };
  } catch {
    // Reviewing is an improvement, never a requirement: a failed call must not fail the build.
    return { edges, reviewed: false, edits: [] };
  }
}
