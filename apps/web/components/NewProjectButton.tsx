"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { PlusIcon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The only intentional way to abandon the current session and start a
 * fresh one — confirms first since it's a hard-to-reverse local action.
 * Never touches the database itself (see store.ts's own comment on
 * `startNewProject`): Save is the only thing that ever writes there, so
 * this can't silently destroy a project you already saved — it just
 * clears `currentProjectId` so the next Save creates a new one.
 *
 * Rendered top-right of ProjectsCard.tsx's own header, styled to match
 * ControlPanel.tsx's "Reset" button exactly — both are a small bordered
 * action sitting opposite a card's title.
 */
export function NewProjectButton({ onDone }: { onDone?: () => void }) {
  const startNewProject = useAppStore((s) => s.startNewProject);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-700"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        New project
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Start a new project?"
        message="This clears the current one from view — save it first if you want to come back to it."
        confirmLabel="Start new project"
        cancelLabel="Keep this project"
        onConfirm={() => {
          setConfirmOpen(false);
          startNewProject();
          onDone?.();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
