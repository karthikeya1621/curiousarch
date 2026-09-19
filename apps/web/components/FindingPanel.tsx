"use client";

import { useState } from "react";
import type { AiFinding, AiFix, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { getFixStatus } from "../lib/getFixStatus";
import { Badge } from "./Badge";
import { SparklesIcon, XIcon, WrenchIcon } from "./icons";

/**
 * Unified finding + fix detail. A fix's own `label`/`tradeoff` are always
 * visible the moment it's picked — "Ask AI" is a separate, explicitly
 * triggered call for one or two extra sentences on why *this* fix fits
 * *this* system, never fired automatically on selection (see explainFix.ts).
 *
 * Picking a fix no longer calls the AI here — it QUEUES the choice
 * (store.ts's `queueFix`), synchronously, no network call. Re-simulate is
 * what actually implements it (see ResimulateButton.tsx), alongside its
 * own holistic review — this is the cost-saving trade approved for this
 * flow specifically (chat-driven changes stay immediate).
 */
export function FindingPanel({ model, finding }: { model: SystemModel; finding: AiFinding }) {
  const selectedFixId = useAppStore((s) => s.selectedFixId);
  const selectFix = useAppStore((s) => s.selectFix);
  const selectFinding = useAppStore((s) => s.selectFinding);
  const queueFix = useAppStore((s) => s.queueFix);
  const unqueueFix = useAppStore((s) => s.unqueueFix);
  const appliedFixes = useAppStore((s) => s.appliedFixes);
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const status = getFixStatus(finding, appliedFixes, pendingFixes);
  const queuedFixId = pendingFixes.find(
    (p) => p.componentId === finding.componentId && p.findingTitle === finding.title,
  )?.fixId;

  const [rationale, setRationale] = useState<string | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function askAi(fix: AiFix) {
    if (askingAi) return;
    setAskingAi(true);
    setAskError(null);
    try {
      const res = await fetch("/api/explain-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          componentId: finding.componentId,
          fixLabel: fix.label,
          findingCode: finding.code,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to explain fix.");
      setRationale(body.rationale as string);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Failed to explain fix.");
    } finally {
      setAskingAi(false);
    }
  }

  function toggleQueue(fix: AiFix) {
    if (queuedFixId === fix.id) {
      unqueueFix(finding.componentId, finding.title);
    } else {
      queueFix({
        componentId: finding.componentId,
        findingCode: finding.code,
        findingTitle: finding.title,
        fixId: fix.id,
        fixLabel: fix.label,
        fixTradeoff: fix.tradeoff,
        queuedAt: Date.now(),
      });
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone={finding.severity === "critical" ? "critical" : "warning"}>
            {finding.severity}
          </Badge>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{finding.title}</p>
        </div>
        <button
          onClick={() => selectFinding(null)}
          aria-label="Close finding"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{finding.explanation}</p>
      {status === "queued" && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Badge tone="warning">Queued</Badge>
          Re-simulate to see this fix in action.
        </p>
      )}
      {status === "fixed" && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Badge tone="success">Fixed</Badge>
          Re-simulate to confirm and refresh this finding.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {finding.fixes.map((fix) => {
          const isSelected = fix.id === selectedFixId;
          const isQueued = queuedFixId === fix.id;
          return (
            <div
              key={fix.id}
              className={
                "rounded-lg border text-sm transition-colors " +
                (isSelected ? "border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-700" : "border-slate-200 dark:border-slate-700")
              }
            >
              <button
                onClick={() => {
                  selectFix(isSelected ? null : fix.id);
                  setRationale(null);
                  setAskError(null);
                }}
                className="w-full px-3 py-2 text-left"
              >
                <span className="font-medium text-slate-900 dark:text-slate-100">{fix.label}</span>
                <p className="text-xs text-slate-500 dark:text-slate-400">{fix.tradeoff}</p>
              </button>
              {isSelected && (
                <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-600">
                  {rationale && <p className="text-xs italic text-slate-500 dark:text-slate-400">{rationale}</p>}
                  {askError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{askError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => askAi(fix)}
                      disabled={askingAi}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:enabled:hover:border-slate-500 dark:enabled:hover:bg-slate-600"
                    >
                      <SparklesIcon className="h-3 w-3" />
                      {askingAi ? "Asking…" : "Ask AI"}
                    </button>
                    <button
                      onClick={() => toggleQueue(fix)}
                      className={
                        "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                        (isQueued
                          ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                          : "bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300")
                      }
                    >
                      {isQueued && <WrenchIcon className="h-3 w-3" />}
                      {isQueued ? "Queued — click to remove" : "Queue this fix"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
