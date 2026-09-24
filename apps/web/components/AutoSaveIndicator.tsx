"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import { timeAgo } from "../lib/timeAgo";
import { AlertTriangleIcon, CheckCircleIcon } from "./icons";

const AUTO_SAVE_DEBOUNCE_MS = 1500;

/**
 * Replaces the old manual Save button — the session now persists itself
 * automatically, debounced so a burst of changes (a chat exchange, a
 * couple of queued fixes) writes once, not on every intermediate state.
 * The actual write is still `saveToStorage` (lib/store/slices/projectSlice.ts), unchanged
 * from when a click triggered it; this only decides *when* to call it.
 *
 * Watches `autosaveRevision` specifically, not `model`/`chatMessages`/etc.
 * directly — that counter is bumped only by actions the store itself
 * considers save-worthy (a build, a chat reply, queueing a fix, a Reset,
 * restoring a version, a completed Re-simulate), and deliberately NOT by
 * `setWorkloadTier` (moving the tier slider is a parameter change to
 * review, not to persist on its own — see AppState's own doc comment on
 * `autosaveRevision`). This also means loading a project
 * (hydrateFromStorage/openProject) never bumps it, so — unlike the old
 * design, which had to explicitly detect "did we just load" — there's
 * nothing to skip beyond the ordinary first-mount run every effect gets.
 */
export function AutoSaveIndicator() {
  const model = useAppStore((s) => s.model);
  const autosaveRevision = useAppStore((s) => s.autosaveRevision);
  const saveToStorage = useAppStore((s) => s.saveToStorage);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const hydrated = useAppStore((s) => s.hydrated);
  const isBlank = model.components.length === 0;

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [, forceTick] = useState(0);
  const isFirstRun = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keeps "Saved Xm ago" from going stale while idle.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Every mount runs its effects at least once regardless of whether
    // the dependency "changed" from some prior state — skip that one so
    // mounting on an already-loaded project doesn't immediately re-save
    // exactly what was just loaded.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (!hydrated || isBlank) return;

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setStatus("saving");
      const ok = await saveToStorage();
      setStatus(ok ? "idle" : "error");
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [autosaveRevision, hydrated, isBlank, saveToStorage]);

  async function retry() {
    setStatus("saving");
    const ok = await saveToStorage();
    setStatus(ok ? "idle" : "error");
  }

  if (isBlank) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      {status === "saving" ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-slate-400" />
          Saving…
        </>
      ) : status === "error" ? (
        <button onClick={() => void retry()} className="flex items-center gap-1 text-rose-600 hover:underline">
          <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
          Save failed — retry
        </button>
      ) : (
        lastSavedAt && (
          <>
            <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Saved {timeAgo(lastSavedAt)}
          </>
        )
      )}
    </div>
  );
}
