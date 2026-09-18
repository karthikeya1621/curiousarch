"use client";

import { useState } from "react";
import type { AiFinding, AiFix, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { isFindingFixed } from "../lib/isFindingFixed";
import { Badge } from "./Badge";
import { SparklesIcon, XIcon } from "./icons";

/**
 * Unified finding + fix detail. A fix's own `label`/`tradeoff` are always
 * visible the moment it's picked — "Ask AI" is a separate, explicitly
 * triggered call for one or two extra sentences on why *this* fix fits
 * *this* system, never fired automatically on selection (see explainFix.ts).
 */
export function FindingPanel({ model, finding }: { model: SystemModel; finding: AiFinding }) {
  const selectedFixId = useAppStore((s) => s.selectedFixId);
  const selectFix = useAppStore((s) => s.selectFix);
  const selectFinding = useAppStore((s) => s.selectFinding);
  const applyFix = useAppStore((s) => s.applyFix);
  const appliedFixes = useAppStore((s) => s.appliedFixes);
  const alreadyFixed = isFindingFixed(finding, appliedFixes);

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
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

  async function apply(fix: AiFix) {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/apply-ai-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, finding, fix }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to apply fix.");
      applyFix(body.model as SystemModel, {
        componentId: finding.componentId,
        findingTitle: finding.title,
        fixLabel: fix.label,
        appliedAt: Date.now(),
      });
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply fix.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone={finding.severity === "critical" ? "critical" : "warning"}>
            {finding.severity}
          </Badge>
          <p className="text-sm font-semibold text-slate-900">{finding.title}</p>
        </div>
        <button
          onClick={() => selectFinding(null)}
          aria-label="Close finding"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-500">{finding.explanation}</p>
      {alreadyFixed && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600">
          <Badge tone="success">Fixed</Badge>
          Re-simulate to confirm and refresh this finding.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {finding.fixes.map((fix) => {
          const isSelected = fix.id === selectedFixId;
          return (
            <div
              key={fix.id}
              className={
                "rounded-lg border text-sm transition-colors " +
                (isSelected ? "border-slate-300 bg-slate-50" : "border-slate-200")
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
                <span className="font-medium text-slate-900">{fix.label}</span>
                <p className="text-xs text-slate-500">{fix.tradeoff}</p>
              </button>
              {isSelected && (
                <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2">
                  {rationale && <p className="text-xs italic text-slate-500">{rationale}</p>}
                  {askError && <p className="text-[11px] text-rose-600">{askError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => askAi(fix)}
                      disabled={askingAi}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <SparklesIcon className="h-3 w-3" />
                      {askingAi ? "Asking…" : "Ask AI"}
                    </button>
                    <button
                      onClick={() => apply(fix)}
                      disabled={applying}
                      className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applying ? "Applying…" : "Apply this fix"}
                    </button>
                  </div>
                  {applyError && <p className="text-[11px] text-rose-600">{applyError}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
