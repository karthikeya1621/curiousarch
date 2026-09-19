"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "../lib/store";
import { timeAgo } from "../lib/timeAgo";
import { Card } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { NewProjectButton } from "./NewProjectButton";
import { FolderIcon, TrashIcon, CheckCircleIcon } from "./icons";

/**
 * Always-visible, not a dropdown — same reasoning as ControlPanel.tsx's
 * own "Controls" card: something checked often enough belongs in view,
 * not behind a click. "+ New project" sits top-right exactly like
 * Controls' own "Undo" button, so the two cards read as one family.
 * Re-fetches whenever a save could have changed the list (mount,
 * `currentProjectId`, or `lastSavedAt` changing) — a cheap DB query, no
 * AI cost involved.
 */
export function ProjectsCard() {
  const projects = useAppStore((s) => s.projects);
  const projectsStatus = useAppStore((s) => s.projectsStatus);
  const refreshProjectList = useAppStore((s) => s.refreshProjectList);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProjectById = useAppStore((s) => s.deleteProjectById);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const isBlank = useAppStore((s) => s.model.components.length === 0);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void refreshProjectList();
  }, [refreshProjectList, currentProjectId, lastSavedAt]);

  function handleRowClick(id: string) {
    if (id === currentProjectId) return;
    // Only worth confirming when there's something non-blank to lose —
    // same guard NewProjectButton's own confirm applies.
    if (!isBlank) {
      setPendingOpenId(id);
      return;
    }
    void openProject(id);
  }

  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Projects
        </h3>
        <NewProjectButton />
      </div>

      <div className="mt-3 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {projectsStatus === "loading" && projects.length === 0 ? (
          <p className="px-1 py-1.5 text-xs text-slate-400">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="px-1 py-1.5 text-xs text-slate-400">
            No saved projects yet — build one and click Save.
          </p>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className={
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors " +
                (p.id === currentProjectId
                  ? "bg-slate-50 dark:bg-slate-700"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700")
              }
            >
              <button
                onClick={() => handleRowClick(p.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {p.id === currentProjectId ? (
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span
                  className={
                    "min-w-0 flex-1 truncate " +
                    (p.id === currentProjectId
                      ? "font-medium text-slate-900 dark:text-slate-100"
                      : "text-slate-700 dark:text-slate-300")
                  }
                >
                  {p.name || "Untitled"}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {timeAgo(p.updatedAt)}
                </span>
              </button>
              <button
                onClick={() => setPendingDeleteId(p.id)}
                aria-label="Delete project"
                className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingOpenId !== null}
        title="Open this project?"
        message="This clears the current one from view — save it first if you want to come back to it."
        confirmLabel="Open project"
        cancelLabel="Keep this project"
        onConfirm={() => {
          const id = pendingOpenId!;
          setPendingOpenId(null);
          void openProject(id);
        }}
        onCancel={() => setPendingOpenId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this project?"
        message="This permanently deletes it — there's no undo."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          const id = pendingDeleteId!;
          setPendingDeleteId(null);
          void deleteProjectById(id);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </Card>
  );
}
