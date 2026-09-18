import type { AiFinding } from "@archsim/engine";
import type { AppliedFixRecord } from "./sessionStorage";

/**
 * True when a fix has already been applied for this exact finding —
 * matched by componentId + title, which is reliable specifically because
 * `findings` never changes between an Apply click and the next
 * Re-simulate (that's the whole point of the stale-findings design, see
 * store.ts's own comment): the title recorded in `appliedFixes` at apply
 * time is the exact same string still shown here. Used to mark a stale
 * finding as already handled instead of leaving it looking unaddressed
 * until the next Re-simulate — cheaper than re-running identifyFailures
 * just to confirm what the user already told the app.
 */
export function isFindingFixed(finding: AiFinding, appliedFixes: AppliedFixRecord[]): boolean {
  return appliedFixes.some((f) => f.componentId === finding.componentId && f.findingTitle === finding.title);
}
