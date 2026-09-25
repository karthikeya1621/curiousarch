/**
 * "Re-simulate": a full rebuild of the current system, seeded from its own
 * current state instead of typed prose. Same category of operation as
 * `fromProse` — produce a candidate `SystemModel` — and shares its exact
 * validated, retried, strict-mode-hardened call via `structuredCall.ts`'s
 * `runStructuredCall` (see that file's own comment on why this is shared
 * rather than duplicated).
 *
 * This produces a model, never a finding. Whatever the rework changes,
 * `identifyFailures.ts` is what decides what's wrong with the result —
 * called again after every rework, exactly as it's called after every
 * other model change.
 *
 * A validation failure here is expensive twice over — it costs a full
 * extra billed attempt (structuredCall.ts's repair-retry loop re-sends the
 * entire invalid model as input), and this call's own `maxRetries` is 2, not
 * 1, so a bad prompt here compounds harder than anywhere else in the
 * engine. Strict mode already guarantees the JSON *shape* is valid; the
 * only failures actually reachable are the ones only Zod's `superRefine`
 * can catch (schema.ts's `STRUCTURAL_SELF_CHECK`, interpolated into the
 * prompt below) — and rework, which edits an existing graph rather than
 * building one from nothing, is exactly where those show up (a removed
 * component's edge left dangling; a reused id). Prompted against
 * specifically after a user-reported retry cost concern; apps/web's usage
 * tracking (`ai_calls.attempt`/`ai_label_stats.retry_pct`) is what actually
 * measures whether this reduced the real rate — check it before tightening
 * further.
 *
 * Unlike `fromProse`, there's no separate workload-parameters call here.
 * The user sets a new tier by moving a control, not by describing one —
 * Re-simulate's job is reworking the ARCHITECTURE for a tier that's
 * already set, not deciding the tier itself. `workload.users`/
 * `workload.requests` are carried forward from the input model unchanged;
 * the AI sees them (as context, in the JSON dump below) but its own
 * output schema never asks it to reproduce them.
 *
 * `pendingFixes` (optional): fixes the user has explicitly chosen since
 * the last Re-simulate, queued rather than implemented immediately (see
 * apps/web/lib/store/slices/queueSlice.ts's comment on `pendingFixes` — this is the
 * cost-saving trade that replaced a separate AI call per fix). They're
 * appended to the USER content, not REWORK_PROMPT itself, so the static
 * system prompt stays byte-identical (and therefore
 * cacheable) across every rework call regardless of how many fixes are
 * queued this time.
 *
 * `pendingChanges` (optional): changes the user asked for in chat since the
 * last Re-simulate. Chat no longer edits the model itself — it queues the
 * request, and this call is what implements it (alongside `pendingFixes`,
 * same user-content placement and for the same caching reason). Each carries
 * the user's own words AND a self-contained instruction written when the
 * message was sent (references like "it"/"that one" already resolved against
 * the conversation and any earlier queued change), so nothing about what was
 * meant is lost by the time the conversation has scrolled out of the chat
 * history window.
 *
 * A second call, sequential and unconditional, always follows the base
 * rework above: `extendedComponents.ts`'s `reviseExtendedComponents`
 * re-evaluates any components of the 7 "extended" kinds (external
 * dependency, load balancer, ...) this system has. Same "no compiled-
 * grammar room" reason those kinds aren't part of `SystemModelSchema` at
 * all — the base call above literally cannot represent them in its own
 * output. It is therefore not shown them at all (`baseView` takes them, and
 * every edge touching one, out of its input; a short note names them by kind
 * and label, never id), and any reference to one that still slips in via the
 * user's own queued text is stripped in code (`stripExtendedReferences`)
 * rather than costing a retry. This second call is what actually keeps them
 * up to date: it's given the ORIGINAL edges touching them so the wiring and
 * its direction survive (`checkNoDroppedExtendedEdges` enforces that), and
 * the base call's freshly reworked component ids to re-point any edge whose
 * base end was replaced.
 */

import { STRUCTURAL_SELF_CHECK, SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { EXTENDED_KINDS, isExtendedComponent, reviseExtendedComponents } from "./extendedComponents.ts";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { TIER_GROUP_GUIDE } from "./tierGuide.ts";
import { collapseParallelAsyncPaths } from "./lintTopology.ts";
import { cleanModelIdentity, MAX_BASE_COMPONENTS, type Component, type SystemModel } from "../types.ts";

const REWORK_PROMPT = `You are reconsidering an EXISTING rough architectural model, not describing a new system from scratch. You will be given the current model as JSON - its components, their traits, the edges between them, and its workload.users/workload.requests for context (each has "included": whether that dimension is relevant to this system, "tier": the current rough step on a small ladder, and "target": the original ambition for it). Some of it may already reflect real fixes that were applied (an added component, a corrected trait). You may also be given a list of specific fixes the user has already chosen to apply, and a list of changes the user asked for in chat.

If specific fixes or requested changes are listed, implement each of them precisely first - they are already-decided choices, not suggestions to evaluate. Requested changes are listed oldest first; where a later one conflicts with (or cancels) an earlier one, the later one wins. If a requested change is about one of the EXTENDED kinds described below, do not attempt it yourself - the separate step that owns those kinds implements it, so your own output simply doesn't change on account of that part of the request; only make a base-kind change for a request that genuinely calls for one. Then reconsider the ARCHITECTURE holistically on top of that, the way an architect revisiting a system does: given where this system stands now (including its current scale), does it call for anything more - additional scaling on a component, a new service, a new connection, a component that should be split or added, a trait that's clearly wrong given the rest of the system? You may leave everything else exactly as it is if nothing more is warranted - do not change something just to have changed it. You are not deciding the workload parameters themselves - only the architecture that serves them.

Some parts of a system are of an EXTENDED kind (${EXTENDED_KINDS.join(", ")}). Those belong to a separate step: you are NOT shown them in the model JSON (at most a short note after it says they exist), so never output a component of one of those kinds, never reuse a name that sounds like one as a component id, and never reference one in an edge - every edge you output must connect two components that are in YOUR output. That separate step re-wires them into your result afterwards, so nothing about them is lost by your leaving them out. Every connection between two components you both keep must still exist in your output unless the architecture genuinely no longer calls for it. Dropping one for any other reason is a mistake - when in doubt, keep it. When a chosen fix or requested change puts a component BETWEEN two you keep (a queue, a cache, a proxy), route the connection through it and remove the direct edge - keeping both leaves two competing paths. List each edge once.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- Beyond the extended kinds mentioned above (which you never emit yourself), you may only use the five base component kinds (gateway, service, cache, database, queue) - don't invent another new one.
- For anything that still conceptually exists from the input, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing across a rework, not a new one. Only mint a new id for a component that's genuinely new.
- Instance counts are yours to keep right, automatically. Judge each service's and database's instanceCount from the system's CURRENT scale (its workload tiers, in the model) using the tier groups below, and set it yourself as part of this rework - nobody will separately ask you to. Move it to the larger value when its tier group calls for it, and back to the smallest when the scale is lowered; give the trait a rationale that names the scale, with provenance "inferred". Do this on every rework, even when the user asked for nothing else.

${TIER_GROUP_GUIDE}
- Scale alone never switches on a protection. Rate limiting, circuit breakers, stampede protection, dead-letter queues and health checks are exactly what the separate review step reports as risks, so leave each one as it is unless a listed fix or requested change asks for it. Only instance counts (above) move by themselves. A protection you leave off is not a mistake here.
- Keep the same top-level "id" and "name" - you are reworking this system, not renaming it.
- Preserve every existing connection between two components you're both keeping unless you have a specific architectural reason to remove it (including routing it through a newly inserted component) - a rework that silently drops real connections produces a diagram that no longer reflects the actual system.
- At most ${MAX_BASE_COMPONENTS} components in your own output. If the holistic review would call for more, that's a sign to fold or reconsider something already there before adding, not to grow past the limit.
- Every trait still needs a rationale and a provenance. "stated" means the input model already had this value and you're keeping it because it's still correct - never mark something "stated" that you are choosing or changing yourself; that's "inferred" (derived from something else in the system) or "default" (your own reasonable choice, nothing in the system dictates it). Keep every rationale to one short, specific sentence of roughly 8 to 15 words; for a trait you are leaving as it was, restate its reason more briefly rather than copying it at length.
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

${STRUCTURAL_SELF_CHECK}

Output only the structured model. Do not add findings, recommendations, or commentary - a separate step decides what's wrong with the model you produce, not you.`;

export type { StructuredCallOptions as ReworkModelOptions };
export interface ReworkModelResult {
  model: SystemModel;
  raw: unknown;
  repaired: boolean;
}

/** A fix the user has already chosen to apply — see this file's own top comment. */
export interface PendingFixInput {
  componentId: string;
  findingTitle: string;
  fixLabel: string;
  fixTradeoff: string;
}

/**
 * A change the user asked for in chat — see this file's own top comment.
 * `request` is their exact words; `instruction` is the self-contained
 * restatement the chat step wrote (real component ids, references resolved).
 */
export interface PendingChangeInput {
  request: string;
  instruction: string;
}

export function formatPendingChanges(pendingChanges: PendingChangeInput[]): string {
  if (pendingChanges.length === 0) return "";
  const lines = pendingChanges
    .map((c, i) => `${i + 1}. The user asked: "${c.request}"\n   Instruction: ${c.instruction}`)
    .join("\n");
  return `\n\nThe user has also asked for these changes to the architecture in chat (oldest first; a later one overrides an earlier one where they conflict) — implement each one, in addition to your normal holistic review:\n${lines}`;
}

export function formatPendingFixes(pendingFixes: PendingFixInput[]): string {
  if (pendingFixes.length === 0) return "";
  const lines = pendingFixes
    .map((f) => `- On "${f.componentId}": ${f.fixLabel} (addressing: ${f.findingTitle}) — tradeoff: ${f.fixTradeoff}`)
    .join("\n");
  return `\n\nThe user has specifically chosen to apply these fixes — implement each one precisely, in addition to your normal holistic review:\n${lines}`;
}

/**
 * Enforces, in code, the one continuity rule REWORK_PROMPT already states
 * but the model isn't guaranteed to follow: "preserve every existing edge
 * between two components you're both keeping." Zod's own superRefine
 * (schema.ts) can't check this — it only ever sees the proposed output in
 * isolation, never the model being revised — so a repair-retry that patches
 * a badly degenerate first attempt just enough to satisfy every Zod rule,
 * without regenerating an actually complete answer, sails through as a
 * schema-valid "success" while silently discarding most of the input.
 * Confirmed live: exactly this happened on a real Re-simulate — a
 * catastrophically malformed first attempt got "repaired" into a
 * schema-valid model with a single edge total, missing almost the whole
 * previous architecture.
 *
 * Only BASE-kind components/edges are ever in scope: `result` (the base
 * call's own output) never contains an extended-kind component by design —
 * a real omission it OMITTED on purpose, not one it dropped — and an edge
 * to one is the revise step's to own, never this call's, so it's correctly
 * excluded from `baseIds` and therefore never flagged here.
 *
 * A component the result legitimately removed is exempt — "you're both
 * keeping" is false for it, so there's nothing to preserve, and choosing to
 * remove something is a real (if rare) holistic-review outcome, not this
 * bug. What's never legitimate is dropping the CONNECTION between two
 * components that are both still present under the same id.
 *
 * Exported for direct, fast unit tests — the full integration (that a
 * violation actually triggers a real repair-retry through
 * `runStructuredCall`) has its own separate test.
 */
export function checkNoDroppedEdges(input: SystemModel, result: SystemModel): string | null {
  const baseIds = new Set(input.components.filter((c) => !isExtendedComponent(c)).map((c) => c.id));
  const resultIds = new Set(result.components.map((c) => c.id));
  const kept = (id: string) => baseIds.has(id) && resultIds.has(id);
  const reachable = reachability(result.edges);

  // What must survive is the CONNECTION, not the literal edge: a fix that
  // inserts a queue between two services legitimately replaces their direct
  // edge with a path through the new component. Judged on unique pairs, so an
  // edge the input listed twice can't be "dropped" twice (or at all, by
  // emitting it once).
  const dropped = dedupeEdges(input.edges).filter(
    (e) => kept(e.from) && kept(e.to) && !reachable(e.from, e.to),
  );
  if (dropped.length === 0) return null;

  const list = dropped.map((e) => `"${e.from}" -> "${e.to}"`).join(", ");
  const noun = dropped.length === 1 ? "connection" : "connections";
  const them = dropped.length === 1 ? "it" : "them";
  return (
    `You dropped ${dropped.length} ${noun} between components you're keeping, without being asked to: ${list}. ` +
    `Every connection between two components you both kept must still exist (directly, or through a component ` +
    `you inserted between them) - restore ${them}, unless the request specifically required removing ${them}.`
  );
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

/** `reachable(a, b)`: is there a path (of one or more edges) from a to b? */
function reachability(edges: { from: string; to: string }[]): (from: string, to: string) => boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  return (from, to) => {
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
}

interface RawTrait {
  value?: unknown;
  provenance?: unknown;
  rationale?: unknown;
}
const isTrait = (v: unknown): v is RawTrait => typeof v === "object" && v !== null && "value" in v;
const isMitigation = (key: string) => /^has[A-Z]/.test(key);

/**
 * Keeps the rework honest about what it changed, in code, because the prompt
 * alone wasn't enough (found live on a real project):
 * - a trait whose value is unchanged keeps its previous provenance and
 *   rationale (an instance count keeps only the provenance: its rationale names
 *   the scale, which may have moved) — the model kept re-labelling old traits "stated" a pass at a
 *   time until nearly everything claimed to be stated, when nothing was;
 * - anything the rework itself changed or added is at most "inferred" — there
 *   is no prose here for it to have been "stated" in;
 * - when nothing was asked for (no queued fix or chat change), a protection
 *   (`has…` trait) that was off stays off: raising the scale once switched on
 *   rate limiting, breakers and stampede protection everywhere, which left
 *   the review step nothing to find.
 * Applied before validation, so it costs no retry.
 */
export function reconcileWithPrevious(raw: unknown, previous: SystemModel, opts: { anythingAsked: boolean }): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { components?: unknown }).components)) return raw;
  const before = new Map(previous.components.map((c) => [c.id, c as unknown as Record<string, unknown>]));
  const components = (raw as { components: unknown[] }).components.map((c) => {
    if (typeof c !== "object" || c === null) return c;
    const comp = c as Record<string, unknown>;
    const old = before.get(String(comp.id));
    const out: Record<string, unknown> = { ...comp };
    for (const [key, trait] of Object.entries(comp)) {
      if (!isTrait(trait)) continue;
      const prev = old?.[key];
      if (isTrait(prev) && JSON.stringify(prev.value) === JSON.stringify(trait.value)) {
        // An instance count's rationale names the scale it was judged at, so
        // carrying the old sentence forward leaves "10,000 users" on a system
        // now at 1,000,000 (seen live). Keep its provenance, take the fresh reason.
        out[key] = key === "instanceCount" ? { ...trait, provenance: prev.provenance } : prev;
      } else if (isTrait(prev) && !opts.anythingAsked && isMitigation(key) && prev.value === false && trait.value === true) {
        out[key] = prev;
      } else if (trait.provenance === "stated") {
        out[key] = { ...trait, provenance: "inferred" };
      }
    }
    return out;
  });
  return { ...(raw as object), components };
}

/**
 * What the base call is shown: the model with every extended-kind component,
 * and every edge touching one, taken OUT. Found live, four Re-simulates out of
 * four: shown those components (and told not to reference them), the model
 * kept re-emitting them anyway — as fake base-kind stand-ins filled with
 * placeholder text, or as edges to ids that weren't in its output — and each
 * mistake cost a full billed retry that re-sent the whole model. The
 * instructions conflicted ("preserve every edge" vs "leave these out"), and
 * the model split the difference badly. Not showing them makes the mistake
 * impossible instead of merely discouraged; the separate extended step
 * re-wires them afterwards from the ORIGINAL model (see `reworkModel`).
 */
/**
 * The system's current scale as a sentence, for a call that isn't shown the
 * workload (the extended-components step): whether a component needs more
 * than one instance depends entirely on it. "" when no dimension is in use.
 */
export function describeScale(workload: SystemModel["workload"]): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const parts: string[] = [];
  if (workload.users?.included) parts.push(`${fmt(workload.users.tier)} users`);
  if (workload.requests?.included) parts.push(`${fmt(workload.requests.tier)} requests`);
  return parts.length > 0 ? `\n\nThe system's current scale is ${parts.join(" and ")}.` : "";
}

export function baseView(model: SystemModel): SystemModel {
  const baseIds = new Set(model.components.filter((c) => !isExtendedComponent(c)).map((c) => c.id));
  return {
    ...model,
    components: model.components.filter((c) => baseIds.has(c.id)),
    edges: dedupeEdges(model.edges.filter((e) => baseIds.has(e.from) && baseIds.has(e.to))),
  };
}

/** A sentence telling the base call the extended parts exist (by kind and name — never id), or "" if there are none. */
function extendedNote(model: SystemModel): string {
  const extended = model.components.filter(isExtendedComponent);
  if (extended.length === 0) return "";
  const list = extended.map((c) => `${c.kind.replace(/-/g, " ")} "${c.label}"`).join(", ");
  return `\n\nThis system also includes these parts, which belong to a separate step you cannot see or change: ${list}. Do not add, remove or mention them, and do not reference them in any edge - that step keeps them wired in after you finish.`;
}

/**
 * Belt and braces for the one way the base call can still name an extended
 * component: the user's own queued text ("add a fallback on \"payments\"")
 * legitimately mentions one. Drops a component that reuses an extended id and
 * every edge touching an extended id — precisely what the prompt asks the
 * model to leave out, done in code instead of costing a retry. Anything else
 * unknown is still a real error and still fails validation.
 */
export function stripExtendedReferences(raw: unknown, extendedIds: ReadonlySet<string>): unknown {
  if (extendedIds.size === 0 || typeof raw !== "object" || raw === null) return raw;
  const out = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(out.components)) {
    out.components = out.components.filter((c) => !extendedIds.has((c as { id?: string } | null)?.id ?? ""));
  }
  if (Array.isArray(out.edges)) {
    out.edges = out.edges.filter((e) => {
      const edge = e as { from?: string; to?: string } | null;
      return !extendedIds.has(edge?.from ?? "") && !extendedIds.has(edge?.to ?? "");
    });
  }
  return out;
}

/**
 * A request for a NEW extended component ("store videos in object storage")
 * makes the base call wire an edge to it under whatever id the instruction
 * used — an id that isn't in its own output, because the extended step owns
 * that component (seen live: `Edge references unknown component "video-storage"`,
 * a billed retry). An edge to an id that isn't in the output but IS named in the
 * user's own queued text is that case, and is dropped here; the extended step
 * wires the new component up. An unknown id nobody mentioned is still a real
 * mistake and still fails validation. Components are never touched.
 */
export function dropEdgesToMentionedUnknowns(raw: unknown, queuedText: string): unknown {
  if (typeof raw !== "object" || raw === null || queuedText === "") return raw;
  const out = raw as { components?: unknown; edges?: unknown };
  if (!Array.isArray(out.components) || !Array.isArray(out.edges)) return raw;
  const present = new Set(out.components.map((c) => (c as { id?: string } | null)?.id ?? ""));
  const mentioned = new Set(queuedText.match(/[a-z0-9]+(?:-[a-z0-9]+)+/gi)?.map((t) => t.toLowerCase()) ?? []);
  const edges = out.edges.filter((e) => {
    const edge = e as { from?: string; to?: string } | null;
    return [edge?.from, edge?.to].every((id) => typeof id !== "string" || present.has(id) || !mentioned.has(id.toLowerCase()));
  });
  return { ...(raw as object), edges };
}

/** Words in a request that mean the separate extended step, not the base call, owns the change. */
const EXTENDED_REQUEST = new RegExp(`\\b(${EXTENDED_KINDS.map((k) => k.replace(/-/g, "[ -]")).join("|")}|cdn|load balancer|broker|object storage|blob storage|config store|feature flag|cron|scheduled)\\b`, "i");

/**
 * Puts back an original edge whose connection did not survive the whole
 * rework — base call AND extended step together — unless a path between its
 * ends now exists or restoring it would close a cycle. The base call is judged
 * on its own output only (`checkNoDroppedEdges`), so a request such as "add a
 * CDN in front of the gateway" (which the base call can't represent) makes it
 * reroute an edge through a component it can't emit; found live, that cost two
 * billed retries. Fixing the merged graph in code is the reliable half.
 */
export function restoreDroppedConnections<E extends { from: string; to: string }>(
  original: E[],
  components: { id: string }[],
  edges: E[],
): E[] {
  const ids = new Set(components.map((c) => c.id));
  const next = new Map<string, string[]>();
  const add = (e: E) => next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  edges.forEach(add);
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
  const restored: E[] = [];
  for (const e of dedupeEdges(original)) {
    if (!ids.has(e.from) || !ids.has(e.to) || reachable(e.from, e.to) || reachable(e.to, e.from)) continue;
    restored.push(e);
    add(e);
  }
  return [...edges, ...restored];
}

export async function reworkModel(
  input: SystemModel,
  pendingFixes: PendingFixInput[] = [],
  pendingChanges: PendingChangeInput[] = [],
  options: StructuredCallOptions = {},
): Promise<ReworkModelResult> {
  // The id and name are never the AI's to change (the prompt says so), and a
  // rework once copied a JSON-wrapped name forward for good. They come from
  // the input, cleaned, and are put back over whatever the AI returned.
  const model = cleanModelIdentity(input);
  const pendingContext = `${formatPendingFixes(pendingFixes)}${formatPendingChanges(pendingChanges)}`;
  const extendedIds = new Set(model.components.filter(isExtendedComponent).map((c) => c.id));
  const result = await runStructuredCall(
    REWORK_PROMPT,
    `Here is the current model:\n\n${JSON.stringify(baseView(model))}${extendedNote(model)}${pendingContext}`,
    SystemModelSchema,
    buildTool(),
    {
      maxRetries: 2,
      ...options,
      normalizeOutput: (raw) => {
        const stripped = dropEdgesToMentionedUnknowns(
          stripExtendedReferences(raw, extendedIds),
          pendingContext,
        ) as { edges?: { from: string; to: string }[] } | null;
        const deduped =
          stripped && Array.isArray(stripped.edges) ? { ...stripped, edges: dedupeEdges(stripped.edges) } : stripped;
        return reconcileWithPrevious(deduped, model, { anythingAsked: pendingFixes.length + pendingChanges.length > 0 });
      },
      // A request the extended step owns ("add a CDN in front of the gateway")
      // legitimately reroutes base edges through a component this call can't
      // emit, so the base-only check would reject a correct answer; the merged
      // graph is repaired below instead.
      validateResult: (data) =>
        EXTENDED_REQUEST.test(pendingContext) ? null : checkNoDroppedEdges(model, data as SystemModel),
    },
    "reworkModel",
  );

  // Sequential, not parallel — this needs the FRESHLY reworked base
  // component ids (the base call above may have added/renamed/removed
  // some) to correctly wire the extended components back in. Previous
  // extended components come from the INPUT model, not the base rework's
  // own output — that output can never contain them (see REWORK_PROMPT).
  const previousExtended: Component[] = model.components.filter(isExtendedComponent);
  // A queued fix or a chat-requested change can target an extended component
  // ("add a fallback" on an external-dependency, "add a CDN") — and the base
  // call above is told to leave exactly those to this step, so this is the
  // ONLY place they get implemented. Passed as `additionalContext` so it
  // isn't silently ignored by a call that otherwise only sees "previous
  // extended components" + "current base topology". Empty when nothing is
  // queued, which is a no-op here exactly as it is on the base call.
  // The edges the revise step must keep: everything in the ORIGINAL model
  // touching an extended component — including the ones the base call was
  // never shown.
  const previousEdges = model.edges.filter((e) => extendedIds.has(e.from) || extendedIds.has(e.to));
  const extended = await reviseExtendedComponents(
    previousExtended,
    result.data,
    options,
    `${pendingContext}${describeScale(model.workload)}`,
    previousEdges,
  );

  // The extended step writes its own traits, so the same honesty rules apply
  // to them (found by the live eval: a changed `hasFallback` came back
  // "stated"): unchanged traits keep their provenance and rationale, changed
  // ones are at most "inferred", and a protection nobody asked for stays off.
  const reconciled = reconcileWithPrevious({ components: extended.components }, model, {
    anythingAsked: pendingFixes.length + pendingChanges.length > 0,
  }) as { components: Component[] };
  extended.components = reconciled.components;

  return {
    model: {
      ...result.data,
      id: model.id,
      name: model.name,
      components: [...result.data.components, ...extended.components],
      edges: collapseParallelAsyncPaths(
        [...result.data.components, ...extended.components],
        restoreDroppedConnections(
          model.edges,
          [...result.data.components, ...extended.components],
          [...result.data.edges, ...extended.edges],
        ),
      ),
      workload: { ...result.data.workload, users: model.workload.users, requests: model.workload.requests },
    },
    raw: result.raw,
    repaired: result.repaired,
  };
}
