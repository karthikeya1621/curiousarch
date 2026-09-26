import type { SystemModel } from "@archsim/engine";

/**
 * What changed between two models: components added and removed, traits whose
 * value changed, and connections added and removed. Used to show what a
 * Re-simulate did (the version list) and to warn when it REMOVED something
 * nobody asked it to — the failure that wiped six components from a real
 * project unnoticed. Pure, so it is unit-tested without a browser.
 */
export interface ModelDiff {
  addedComponents: { id: string; label: string; kind: string }[];
  removedComponents: { id: string; label: string; kind: string }[];
  changedTraits: { id: string; label: string; trait: string; from: string; to: string }[];
  addedEdges: { from: string; to: string }[];
  removedEdges: { from: string; to: string }[];
}

const isTrait = (v: unknown): v is { value: unknown } => typeof v === "object" && v !== null && "value" in v;
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function diffModels(prev: SystemModel, next: SystemModel): ModelDiff {
  const before = new Map(prev.components.map((c) => [c.id, c]));
  const after = new Map(next.components.map((c) => [c.id, c]));
  const brief = (c: { id: string; label: string; kind: string }) => ({ id: c.id, label: c.label, kind: c.kind });

  const changedTraits: ModelDiff["changedTraits"] = [];
  for (const [id, c] of after) {
    const old = before.get(id);
    if (!old) continue;
    for (const [key, trait] of Object.entries(c as unknown as Record<string, unknown>)) {
      const was = (old as unknown as Record<string, unknown>)[key];
      if (isTrait(trait) && isTrait(was) && JSON.stringify(trait.value) !== JSON.stringify(was.value)) {
        changedTraits.push({ id, label: c.label, trait: key, from: show(was.value), to: show(trait.value) });
      }
    }
  }

  const edgeKey = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;
  const beforeEdges = new Set(prev.edges.map(edgeKey));
  const afterEdges = new Set(next.edges.map(edgeKey));
  return {
    addedComponents: next.components.filter((c) => !before.has(c.id)).map(brief),
    removedComponents: prev.components.filter((c) => !after.has(c.id)).map(brief),
    changedTraits,
    addedEdges: next.edges.filter((e) => !beforeEdges.has(edgeKey(e))),
    removedEdges: prev.edges.filter((e) => !afterEdges.has(edgeKey(e))),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One short line for a version list: "+2 components, −1 component, 3 values changed, 4 connections changed". */
export function summarizeDiff(d: ModelDiff): string {
  const parts: string[] = [];
  if (d.addedComponents.length) parts.push(`+${plural(d.addedComponents.length, "component")}`);
  if (d.removedComponents.length) parts.push(`−${plural(d.removedComponents.length, "component")}`);
  if (d.changedTraits.length) parts.push(`${plural(d.changedTraits.length, "value")} changed`);
  const edges = d.addedEdges.length + d.removedEdges.length;
  if (edges) parts.push(`${plural(edges, "connection")} changed`);
  return parts.join(", ") || "No changes";
}

/** The components a Re-simulate removed when nothing queued could have asked for it. */
export function unrequestedRemovals(d: ModelDiff, somethingWasQueued: boolean): ModelDiff["removedComponents"] {
  return somethingWasQueued ? [] : d.removedComponents;
}
