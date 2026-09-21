"use client";

import { useState } from "react";
import { MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

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
 * a queued fix — see store.ts's own comment on why `setWorkloadTier`
 * doesn't refresh findings itself, leaving this button as the deliberate
 * next step). Commits through `commitRework`, not `applyFix` — a rework
 * has nothing new to reconsider immediately after (findings just got
 * refreshed for the model this produced), whereas `applyFix` sets
 * `canResimulate: true` because it's the kind of change that invites a
 * follow-up rework of the whole system, not a self-contained one.
 *
 * Sends `pendingFixes` along with the model — this is the one call that
 * actually implements every queued fix (see reworkModel.ts's own comment
 * on why that context lives in the user content, not the system prompt).
 */
export function ResimulateButton({ model }: { model: SystemModel }) {
  const canResimulate = useAppStore((s) => s.canResimulate);
  const commitRework = useAppStore((s) => s.commitRework);
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resimulate() {
    if (loading || !canResimulate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rework", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, pendingFixes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rework failed.");
      // The result was built from the `model` and `pendingFixes` sent
      // above. If either moved on during the wait (a tier change, a newly
      // queued fix, a different project opened), committing it would
      // discard that edit — and `commitRework` clears the WHOLE queue, so a
      // fix queued mid-flight would be marked applied without ever having
      // been sent to the AI. Withhold it instead and say why.
      const live = useAppStore.getState();
      if (live.model !== model || live.pendingFixes !== pendingFixes) {
        setError("The system changed while Re-simulate was running — run it again to include those changes.");
        return;
      }
      commitRework(body.model as SystemModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rework failed.");
    } finally {
      setLoading(false);
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
        title={!canResimulate && !loading ? "Change a parameter or apply a fix first" : undefined}
        // Solid fill, not the old pale violet-50/border treatment — this
        // sits on top of the canvas now, competing with diagram content
        // for attention, so it needs real visual weight when it's actually
        // actionable. `disabled:opacity-50` still fades it back when
        // there's nothing to do. Cyan, not the database node's existing
        // teal (ComponentNode.tsx) — same "fresh/modern" family the user
        // picked, but a distinct enough hue that a queue/database node
        // tint is never confused with the app's primary action color.
        className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors enabled:hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Re-simulating…" : "Re-simulate"}
      </button>
      {!loading && model.components.length >= NEAR_CAP_THRESHOLD && (
        <p className="max-w-xs text-right text-[11px] text-amber-700 dark:text-amber-400">
          {model.components.length} of {MAX_TOTAL_COMPONENTS} components — close to the limit; the
          next Re-simulate may have little or no room to add more.
        </p>
      )}
      {error && <p className="max-w-xs text-right text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
