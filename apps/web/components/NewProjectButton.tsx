"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { PlusIcon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Starts a fresh project. No confirmation in the normal case: the project
 * being left is saved first (`saveBeforeLeaving` — autosave is debounced, so
 * there's a short window it hasn't caught up, and a moved tier isn't
 * autosaved at all), and nothing is thrown away. It only speaks up if that
 * save FAILED (offline, signed out) — the one case where starting over really
 * would lose work.
 *
 * Not rendered at all on the blank home screen: with nothing open there is
 * nothing to start over from, and describing a system in the box below already
 * creates the new project.
 *
 * Rendered top-right of ProjectsCard.tsx's own header, styled to match
 * ControlPanel.tsx's "Reset" button exactly — both are a small bordered
 * action sitting opposite a card's title.
 */
export function NewProjectButton({ onDone }: { onDone?: () => void }) {
  const startNewProject = useAppStore((s) => s.startNewProject);
  const saveBeforeLeaving = useAppStore((s) => s.saveBeforeLeaving);
  const isBlank = useAppStore((s) => s.model.components.length === 0);
  const [state, setState] = useState<"idle" | "saving" | "save-failed">("idle");

  if (isBlank) return null;

  function start() {
    setState("idle");
    startNewProject();
    onDone?.();
  }

  async function onClick() {
    if (state === "saving") return;
    setState("saving");
    const saved = await saveBeforeLeaving();
    if (saved) start();
    else setState("save-failed");
  }

  return (
    <>
      <button
        onClick={() => void onClick()}
        disabled={state === "saving"}
        className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:enabled:hover:border-slate-500 dark:enabled:hover:bg-slate-700"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        {state === "saving" ? "Saving…" : "New project"}
      </button>
      <ConfirmDialog
        open={state === "save-failed"}
        title="Couldn't save this project"
        message="Starting a new project now would discard your latest changes. Stay to try again, or discard them and continue."
        confirmLabel="Discard and start new"
        cancelLabel="Stay here"
        onConfirm={start}
        onCancel={() => setState("idle")}
      />
    </>
  );
}
