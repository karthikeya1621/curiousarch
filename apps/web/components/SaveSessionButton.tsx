"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "../lib/store";
import { loadSession } from "../lib/sessionStorage";
import { SaveIcon, CheckCircleIcon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

function timeAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Manual, not automatic — the current session (model, history, findings)
 * lives entirely in memory otherwise, so a refresh silently loses it. This
 * writes it to the one saved localStorage slot (see lib/sessionStorage.ts);
 * the app restores it automatically on next load. No naming/multiple slots
 * yet — that's what a future "New project" picker will need, not this.
 *
 * Confirms before overwriting a DIFFERENTLY-NAMED project already in that
 * slot — the single slot means Save is otherwise a silent, irreversible
 * "forget the old one" with no undo, unlike New Project (which never
 * touches the slot at all and already confirms for a much smaller reason).
 */
export function SaveSessionButton() {
  const saveToStorage = useAppStore((s) => s.saveToStorage);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const model = useAppStore((s) => s.model);
  const [justSaved, setJustSaved] = useState(false);
  const [, forceTick] = useState(0);
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null);

  // Keeps "Saved Xm ago" from going stale while the user is idle, without
  // needing every unrelated state change to happen to re-render this.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  function doSave() {
    saveToStorage();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  }

  function handleSave() {
    const previous = loadSession();
    if (previous?.model.name && previous.model.name !== model.name) {
      setOverwriteTarget(previous.model.name);
      return;
    }
    doSave();
  }

  return (
    <>
      <div className="flex flex-col items-end gap-0.5">
        <button
          onClick={handleSave}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          {justSaved ? (
            <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <SaveIcon className="h-3.5 w-3.5" />
          )}
          {justSaved ? "Saved" : "Save"}
        </button>
        {lastSavedAt && !justSaved && (
          <span className="text-[11px] text-slate-400">Saved {timeAgo(lastSavedAt)}</span>
        )}
      </div>
      <ConfirmDialog
        open={overwriteTarget !== null}
        title="Overwrite saved project?"
        message={`This will overwrite your previously saved project ("${overwriteTarget}") with "${model.name}".`}
        confirmLabel="Overwrite"
        cancelLabel="Cancel"
        onConfirm={() => {
          setOverwriteTarget(null);
          doSave();
        }}
        onCancel={() => setOverwriteTarget(null)}
      />
    </>
  );
}
