/**
 * Facts read off the diagram's structure, handed to the findings AI as context:
 * which stores several services share, how a queue or broker is wired, which
 * components fan out widely, which services call which external systems. They are
 * FACTS, not findings — whether a shared database is a risk at this scale, or a
 * fan-out matters, is the AI's judgment. (An Opus trial found deeper findings than
 * Sonnet; the aim here is to give Sonnet the same raw material to reason from,
 * without a hard-coded threshold deciding what counts as a problem.)
 */

import type { SystemModel } from "../types.ts";

const STORES = new Set(["database", "cache", "object-storage"]);
const HUBS = new Set(["queue", "message-broker"]);

export function graphFacts(model: Pick<SystemModel, "components" | "edges">): string {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const callers = (id: string) => [...new Set(model.edges.filter((e) => e.to === id).map((e) => e.from))];
  const callees = (id: string) => [...new Set(model.edges.filter((e) => e.from === id).map((e) => e.to))];
  const label = (id: string) => byId.get(id)?.label ?? id;
  const lines: string[] = [];

  for (const c of model.components) {
    if (STORES.has(c.kind)) {
      const services = callers(c.id).filter((id) => ["service", "external-dependency", "scheduled-job"].includes(byId.get(id)?.kind ?? ""));
      if (services.length >= 2) lines.push(`${c.kind} "${label(c.id)}" is used by ${services.length} components: ${services.map(label).join(", ")}.`);
    }
    if (HUBS.has(c.kind)) {
      lines.push(`${c.kind} "${label(c.id)}": publishers/producers = ${callers(c.id).map(label).join(", ") || "none"}; consumers/subscribers = ${callees(c.id).map(label).join(", ") || "none"}.`);
    }
    if (c.kind === "service" || c.kind === "gateway") {
      const out = callees(c.id);
      if (out.length >= 4) lines.push(`${c.kind} "${label(c.id)}" calls ${out.length} components directly: ${out.map(label).join(", ")}.`);
    }
    if (c.kind === "external-dependency") {
      const from = callers(c.id);
      if (from.length > 0) lines.push(`external system "${label(c.id)}" is called by: ${from.map(label).join(", ")}.`);
    }
  }

  // A component reached both directly and through another component.
  const seen = new Set<string>();
  for (const e of model.edges) {
    for (const mid of callees(e.from)) {
      if (mid !== e.to && callees(mid).includes(e.to) && !seen.has(`${e.from}>${e.to}`)) {
        seen.add(`${e.from}>${e.to}`);
        lines.push(`"${label(e.from)}" reaches "${label(e.to)}" both directly and through "${label(mid)}".`);
      }
    }
  }
  return lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "- (nothing notable)";
}
