"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

/**
 * Gated by `canResimulate`, not always-on: it only lights up once
 * something has actually changed since the last review (a raised tier or
 * an applied fix — see store.ts's own comment on why `setWorkloadTier`
 * doesn't refresh findings itself, leaving this button as the deliberate
 * next step). Commits through `commitRework`, not `applyFix` — a rework
 * has nothing new to reconsider immediately after (findings just got
 * refreshed for the model this produced), whereas `applyFix` sets
 * `canResimulate: true` because it's the kind of change that invites a
 * follow-up rework of the whole system, not a self-contained one.
 */
export function ResimulateButton({ model }: { model: SystemModel }) {
  const canResimulate = useAppStore((s) => s.canResimulate);
  const commitRework = useAppStore((s) => s.commitRework);
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
        body: JSON.stringify({ model }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rework failed.");
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
        className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors enabled:hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Re-simulating…" : "Re-simulate"}
      </button>
      {/* Persistent, not just a hover title — a greyed-out button alone
          reads as "nothing to do here," not "do something else first." */}
      {!canResimulate && !loading && (
        <p className="max-w-xs text-right text-[11px] text-slate-400">
          Change a parameter or apply a fix first
        </p>
      )}
      {error && <p className="max-w-xs text-right text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
