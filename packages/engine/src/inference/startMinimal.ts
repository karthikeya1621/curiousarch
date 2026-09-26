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

const isTraitValue = (v: unknown): v is { value?: unknown; provenance?: unknown } => typeof v === "object" && v !== null && "value" in v;

/**
 * At the lowest tier nothing the AI sets on its own scales beyond the minimum:
 * `instanceCount` is "single" and `consumerScaling` is "fixed" unless the description
 * states otherwise. Found live: a system scaled to 100M users and back down to 100
 * kept every service "multiple" and the database "has-replicas" (protections went
 * back off, because code returns them; instance counts are the AI's call and it
 * did not). This is a CHECK, not a rewrite: the problem is named and the AI repairs
 * it, so the value stays its own decision. Not applied when a request is queued
 * (it may ask for an instance) — the caller decides.
 */
export function checkLowestTierMinimal(components: object[], workload: SystemModel["workload"]): string | null {
  if (!atLowestTier(workload)) return null;
  const bad: string[] = [];
  for (const c of components as Record<string, unknown>[]) {
    const ic = c.instanceCount;
    if (isTraitValue(ic) && ic.provenance !== "stated" && ic.value !== "single") bad.push(`${String(c.id)}.instanceCount is "${String(ic.value)}"`);
    const cs = c.consumerScaling;
    if (isTraitValue(cs) && cs.provenance !== "stated" && cs.value !== "fixed") bad.push(`${String(c.id)}.consumerScaling is "${String(cs.value)}"`);
  }
  if (bad.length === 0) return null;
  return (
    `The system is at its LOWEST tier, so nothing you set yourself scales beyond the minimum: ${bad.join("; ")}. ` +
    `Set instanceCount to "single" and consumerScaling to "fixed" (a value the description states stays) - raising the scale is what raises them, and it has been lowered.`
  );
}
