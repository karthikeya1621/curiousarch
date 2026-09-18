"use client";

import { useAppStore } from "../lib/store";
import { PlusIcon } from "./icons";

/**
 * The only intentional way to abandon the current session and start a
 * fresh one — confirms first since it's a hard-to-reverse local action.
 * Never touches the saved localStorage slot itself (see store.ts's own
 * comment on `startNewProject`): Save is the only thing that ever writes
 * there, so this can't silently destroy a session you already saved.
 */
export function NewProjectButton() {
  const startNewProject = useAppStore((s) => s.startNewProject);

  function handleClick() {
    const confirmed = window.confirm(
      "Start a new project? This clears the current one from view — save it first if you want to come back to it.",
    );
    if (confirmed) startNewProject();
  }

  return (
    <button
      onClick={handleClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <PlusIcon className="h-3.5 w-3.5" />
      New Project
    </button>
  );
}
