"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { SaveIcon, CheckCircleIcon } from "./icons";

/**
 * Manual, not automatic — the current session (model, history, findings)
 * lives entirely in memory otherwise, so a refresh silently loses it. This
 * writes it to the one saved localStorage slot (see lib/sessionStorage.ts);
 * the app restores it automatically on next load. No naming/multiple slots
 * yet — that's what a future "New project" picker will need, not this.
 */
export function SaveSessionButton() {
  const saveToStorage = useAppStore((s) => s.saveToStorage);
  const [justSaved, setJustSaved] = useState(false);

  function handleSave() {
    saveToStorage();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  }

  return (
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
  );
}
