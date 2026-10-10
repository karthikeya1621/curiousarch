"use client";

import { useState } from "react";
import { MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useAppStore, usageProjectId } from "../lib/store";
import { newActionId, reportOutcome } from "../lib/usageClient";
import { isTrialLimit, notifyTrialLimit } from "../lib/trialClient";

// Warn a couple of components before the actual cap, not exactly at it —
// by the time the count reads the hard limit itself, the next Re-simulate
// has already lost its ability to add anything the holistic review might
// call for; a heads-up with a little room left to plan around is more
// useful than one that arrives too late to act on.
const NEAR_CAP_THRESHOLD = MAX_TOTAL_COMPONENTS - 2;

/**
 * Just the button itself — the "N fixes queued" / "parameters changed"
 * notes live in the separate ResimulateNotes.tsx, deliberately not nested
 * inside this component's own container (see FlowDiagram.tsx, which
 * renders them as two independent floating boxes, not one shared one).
 *
 * Gated by `canResimulate`, not always-on: it only lights up once
 * something has actually changed since the last review (a raised tier or
 * a queued fix or chat change — see lib/store/findings.ts's comment on why
 * `setWorkloadTier` doesn't refresh findings itself, leaving this button as
 * the deliberate next step). Commits through `commitRework`, which clears
 * what was pending and refreshes findings for the model the rework produced
 * — there's nothing new to reconsider immediately after.
 *
 * Sends `pendingFixes` and `pendingChanges` (chat requests) along with the
 * model — this is the one call that actually implements every queued item
 * (see reworkModel.ts's own comment on why that context lives in the user
 * content, not the system prompt).
 */
export function ResimulateButton({
  model,
  onBusyChange,
}: {
  model: SystemModel;
  /** Lets FlowDiagram show its own "generating the flow" indicator without lifting this button's loading state into the store. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const canResimulate = useAppStore((s) => s.canResimulate);
  const commitRework = useAppStore((s) => s.commitRework);
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const pendingChanges = useAppStore((s) => s.pendingChanges);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resimulate() {
    if (loading || !canResimulate) return;
    setLoading(true);
    onBusyChange?.(true);
    setError(null);
    try {
      // Shared with the findings refresh `commitRework` starts, so the
      // rework's cost and the version it produces are one action.
      const actionId = newActionId();
      const res = await fetch("/api/rework", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, pendingFixes, pendingChanges, actionId, projectId: usageProjectId() }),
      });
      // A host error page (502/504) is HTML, not JSON: fall back to an empty body so the friendly message shows.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The banner at the top already says the trial is used up - no second message here.
        if (isTrialLimit(body)) return notifyTrialLimit(body);
        if (body.code === "unsafe-result") reportOutcome(actionId, "withheld"); // paid for, but the engine refused to return it
        throw new Error(body.error ?? "Rework failed.");
      }
      // The result was built from the `model`, `pendingFixes` and
      // `pendingChanges` sent above. If any moved on during the wait (a tier
      // change, a newly queued fix or chat change, a different project
      // opened), committing it would discard that edit — and `commitRework`
      // clears the WHOLE queues, so something queued mid-flight would be
      // marked applied without ever having been sent to the AI. Withhold it
      // instead and say why.
      const live = useAppStore.getState();
      if (live.model !== model || live.pendingFixes !== pendingFixes || live.pendingChanges !== pendingChanges) {
        setError("The system changed while Re-simulate was running — run it again to include those changes.");
        reportOutcome(actionId, "withheld"); // billed, but its result was thrown away
        return;
      }
      commitRework(body.model as SystemModel, actionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rework failed.");
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={resimulate}
        disabled={loading || !canResimulate}
        // A native title, not a persistent caption — this now floats over
        // the canvas itself, where permanent explanatory text would just
        // compete with the diagram for attention. A disabled button
        // explaining itself on hover is the standard pattern for a
        // compact toolbar/canvas control (Figma, Miro, etc.); ResimulateNotes
        // stays visible on its own since it's prompting an action, not
        // just explaining an inert state.
        title={!canResimulate && !loading ? "Change a parameter, queue a fix or ask for a change first" : undefined}
        // Solid fill, not the old pale violet-50/border treatment — this
        // sits on top of the canvas now, competing with diagram content
        // for attention, so it needs real visual weight when it's actually
        // actionable. `disabled:opacity-50` still fades it back when
        // there's nothing to do. Cyan, not the database node's existing
        // teal (ComponentNode.tsx) — same "fresh/modern" family the user
        // picked, but a distinct enough hue that a queue/database node
        // tint is never confused with the app's primary action color.
        className="flex items-center gap-1.5 rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors enabled:hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Re-simulating…" : "Re-simulate"}
      </button>
      {!loading && model.components.length >= NEAR_CAP_THRESHOLD && (
        <p className="max-w-xs text-right text-[11px] text-amber-700 dark:text-amber-400">
          {model.components.length} of {MAX_TOTAL_COMPONENTS} components — close to the limit; the
          next Re-simulate may have little or no room to add more.
        </p>
      )}
      {error && <p role="alert" className="max-w-xs text-right text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
