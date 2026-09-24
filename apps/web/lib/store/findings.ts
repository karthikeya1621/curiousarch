import type { AiFinding } from "@archsim/engine";
import { newActionId, reportOutcome } from "../usageClient";
import { derivePending } from "./pending";
import { sequence } from "./sequencing";
import { usageProjectIdOf } from "./session";
import type { StoreGet, StoreSet } from "./types";

/**
 * Findings are AI-generated now (`identifyFailures`), not computed — see
 * packages/engine/README.md and CONTEXT.md for the explicit product
 * decision behind this. They live in the store, not a hook, because the
 * diagram (badge counts) and the sidebar (the actual list) both need the
 * same fetched result, and fetching is async — unlike the old
 * `useScenarios`/`useFixes`, which were synchronous `useMemo`s over a
 * deterministic function call.
 *
 * `refreshFindings` is NOT called from every model change — only from
 * `setModel`/`commitRework`, the two actions that themselves represent
 * "the user asked to see the current state of a system" (a fresh build,
 * or a completed Re-simulate). `setWorkloadTier` deliberately does NOT
 * trigger it, and neither does queueing a fix or a chat change: each is a
 * change to review, not an automatic request for the AI's opinion — that's
 * what the Re-simulate button is for. Every live inference call costs real
 * money, so this is a deliberate cost/freshness tradeoff, not an
 * oversight: `findings` visibly goes stale relative to `model` after any of
 * these, and that's the intended signal to click Re-simulate, not a bug to
 * paper over with an automatic call.
 */
export async function refreshFindings(
  set: StoreSet,
  get: StoreGet,
  // The user action this refresh belongs to — a build's or a Re-simulate's,
  // so its calls and the version it records join to the rest of that
  // action's cost. Standalone (a bare refresh) gets its own.
  actionId: string = newActionId(),
): Promise<void> {
  // Claimed before anything else (including the empty-model early return)
  // so a still-in-flight older call can never overwrite this one's state.
  const epoch = sequence.epoch;
  const seq = ++sequence.findings;
  const { model } = get();
  if (model.components.length === 0) {
    set({ findings: [], findingsStatus: "idle", findingsError: null, findingsStale: false });
    return;
  }
  set({ findingsStatus: "loading", findingsError: null });
  try {
    const res = await fetch("/api/identify-failures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, actionId, projectId: usageProjectIdOf(get()) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to identify failures.");
    const findings = body.findings as AiFinding[];
    // The open project/build was replaced while this was in flight — its
    // findings (and version snapshot) belong to a session that's gone. The
    // call was still billed, so say so (usage tracking's "wasted spend").
    if (epoch !== sequence.epoch) {
      reportOutcome(actionId, "project-switched");
      return;
    }
    const isLatest = seq === sequence.findings;
    // Billed and recorded as a version, but never shown.
    if (!isLatest) reportOutcome(actionId, "superseded");
    set((state) => ({
      // Only the most recent call updates what's on screen; a superseded
      // one still records its version below (that snapshot is valid for
      // the `model` it analyzed regardless of what's live now). The
      // findings now describe `model`, so that becomes the baseline — and
      // what's pending is re-derived against the LIVE model, which may have
      // moved on while this was in flight (previously this just declared
      // the findings fresh, wrongly, if a tier had been moved meanwhile).
      ...(isLatest
        ? {
            findings,
            findingsStatus: "done" as const,
            baselineModel: model,
            ...derivePending(state.model, model, state.pendingFixes, state.pendingChanges),
          }
        : {}),
      // `model` — the value fetched against, captured before the `await`
      // above — not `state.model`, which may have moved on since.
      versions: [...state.versions, { id: crypto.randomUUID(), model, findings, createdAt: Date.now(), actionId }],
      // Findings (and a recorded version) are part of what gets saved, but
      // Build/Re-simulate bump the counter when they START — while these
      // are still loading — so the debounced save captured the OLD
      // findings and, after a Re-simulate, `findingsStale: true`. Without
      // this, that row was never corrected, and reopening the project
      // showed "Based on the previous version…" for one that had just
      // been re-simulated. (The old autosave watched `versions`, which is
      // what used to cover this.) Skipped when nothing here changed state.
      autosaveRevision: state.autosaveRevision + 1,
    }));
  } catch (err) {
    if (epoch !== sequence.epoch || seq !== sequence.findings) return;
    set({
      findingsStatus: "done",
      findingsError: err instanceof Error ? err.message : "Failed to identify failures.",
    });
  }
}
