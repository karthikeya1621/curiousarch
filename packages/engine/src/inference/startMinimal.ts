/**
 * A build starts at the minimum for its tier: at the lowest rung, a system
 * has none of its protections (rate limiting, circuit breakers, stampede
 * protection, dead-letter queues, timeouts, fallbacks, ...) unless the
 * description says it does. They are what the review and the chat then teach
 * and add. The prompts ask for this, but the model reads "the typical case" as
 * "typical in production" for a gateway or a payment call and switches them on
 * (seen live: rate limiting, a circuit breaker and a timeout on a fresh
 * e-commerce build), so it is also enforced here, in code.
 *
 * Only a protection the description STATES ("stated") stays on. One the model
 * chose ("default") or merely derived ("inferred") is switched off: a live
 * build kept an order-service breaker and a payment timeout on as "inferred",
 * with rationales like "so it should guard against slow calls" — a
 * recommendation, not a fact about the system, and exactly what the review is
 * meant to raise. Applied to builds only; a Re-simulate keeps whatever the
 * system already had (see `reconcileWithPrevious`).
 */

import { REQUEST_TIERS, USER_TIERS, type SystemModel } from "../types.ts";

const NOT_MENTIONED = "Not mentioned in the description; a launch starts without it.";

/** True when every workload dimension in use is on the bottom rung (and at least one is in use). */
export function atLowestTier(workload: SystemModel["workload"]): boolean {
  const used: boolean[] = [];
  if (workload.users?.included) used.push(workload.users.tier === USER_TIERS[0]);
  if (workload.requests?.included) used.push(workload.requests.tier === REQUEST_TIERS[0]);
  return used.length > 0 && used.every(Boolean);
}

export function startMinimal<C extends { id: string }>(components: C[], workload: SystemModel["workload"]): C[] {
  if (!atLowestTier(workload)) return components;
  return components.map((component) => {
    let changed = false;
    const out: Record<string, unknown> = { ...(component as Record<string, unknown>) };
    for (const [key, trait] of Object.entries(component as Record<string, unknown>)) {
      const t = trait as { value?: unknown; provenance?: unknown } | null;
      if (/^has[A-Z]/.test(key) && typeof t === "object" && t !== null && t.value === true && t.provenance !== "stated") {
        out[key] = { value: false, provenance: "default", rationale: NOT_MENTIONED };
        changed = true;
      }
    }
    return changed ? (out as unknown as C) : component;
  });
}
