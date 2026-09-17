"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

/**
 * Manual only — never fires from applying a fix. Rebuilds the current
 * model from scratch via the AI (reworkModel), seeded from where the
 * system actually is right now rather than typed prose. Same loading/
 * error local-state shape as ProseInput.tsx, the other place this app
 * makes a network call from a plain button.
 *
 * Commits through the store's `applyFix` action, not `setModel` —
 * deliberately: `applyFix` already means "commit a real change to the
 * model, push undo history, clear stale selections," which is exactly
 * what accepting a rework is. `setModel`'s full history reset is for
 * switching to a *different* system, not reworking the one you're on.
 */
export function ResimulateButton({ model }: { model: SystemModel }) {
  const applyFix = useAppStore((s) => s.applyFix);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resimulate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rework", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rework failed.");
      applyFix(body.model as SystemModel);
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
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors enabled:hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Re-simulating…" : "Re-simulate"}
      </button>
      {error && <p className="max-w-xs text-right text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
