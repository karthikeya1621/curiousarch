"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import { diffModels, summarizeDiff } from "../lib/modelDiff";
import { ClockIcon, ChevronDownIcon } from "./icons";

/**
 * One checkpoint per initial build + completed Re-simulate (see
 * `versions` in lib/store/slices/versionsSlice.ts) — renders nothing until there's more than
 * one to navigate between. An anchored dropdown (same pattern as
 * AccountMenu/ProjectsDropdown) rather than the old row of "V1 V2" pills
 * — scales to many versions without wrapping, and has room to show each
 * one's actual save time, not just a number. Clicking a version enters
 * read-only preview (`previewVersion`); it never mutates anything on its
 * own — see PreviewBanner.tsx for the explicit Restore action.
 */
export function VersionHistory() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const versions = useAppStore((s) => s.versions);
  const previewVersionId = useAppStore((s) => s.previewVersionId);
  const previewVersion = useAppStore((s) => s.previewVersion);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (versions.length < 2) return null;

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <ClockIcon className="h-3.5 w-3.5 text-slate-400" />
        Version History
        <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {versions.map((v, i) => (
              <button
                key={v.id}
                onClick={() => {
                  previewVersion(v.id);
                  setOpen(false);
                }}
                className={
                  "flex flex-col items-start rounded-md px-2.5 py-1.5 text-left text-sm transition-colors " +
                  (previewVersionId === v.id
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700")
                }
              >
                <span className="font-medium">Version {i + 1}</span>
                <span className={previewVersionId === v.id ? "text-[11px] text-slate-300 dark:text-slate-600" : "text-[11px] text-slate-400"}>
                  {new Date(v.createdAt).toLocaleString()}
                </span>
                {i > 0 && (
                  // What this Re-simulate did to the model, against the version before it.
                  <span className={previewVersionId === v.id ? "text-[11px] text-slate-300 dark:text-slate-600" : "text-[11px] text-slate-500 dark:text-slate-400"}>
                    {summarizeDiff(diffModels(versions[i - 1]!.model, v.model))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
