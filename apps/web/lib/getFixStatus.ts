import type { AiFinding } from "@archsim/engine";
import type { AppliedFixRecord, PendingFix } from "./sessionStorage";

export type FixStatus = "none" | "queued" | "fixed";

/**
 * Matched by componentId + title, reliable specifically because
 * `findings` never changes between choosing a fix and the next
 * Re-simulate (that's the whole point of the stale-findings design, see
 * lib/store/findings.ts): the title recorded in `appliedFixes`/
 * `pendingFixes` at the time is the exact same string still shown here.
 *
 * "queued" wins over "fixed" if somehow both exist for the same finding
 * (shouldn't normally happen — `commitRework` clears `pendingFixes` into
 * `appliedFixes` atomically — but a queued choice is the more actionable
 * status to show if it ever does).
 */
export function getFixStatus(
  finding: AiFinding,
  appliedFixes: AppliedFixRecord[],
  pendingFixes: PendingFix[],
): FixStatus {
  const matches = (f: { componentId: string; findingTitle: string }) =>
    f.componentId === finding.componentId && f.findingTitle === finding.title;
  if (pendingFixes.some(matches)) return "queued";
  if (appliedFixes.some(matches)) return "fixed";
  return "none";
}
