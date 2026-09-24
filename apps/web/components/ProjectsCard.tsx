"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import { timeAgo } from "../lib/timeAgo";
import { scrollTopToReveal } from "../lib/scrollTopToReveal";
import { Card } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { NewProjectButton } from "./NewProjectButton";
import { FolderIcon, TrashIcon, CheckCircleIcon } from "./icons";

/**
 * Always-visible, not a dropdown — same reasoning as ControlPanel.tsx's
 * own "Controls" card: something checked often enough belongs in view,
 * not behind a click. "+ New project" sits top-right exactly like
 * Controls' own "Reset" button, so the two cards read as one family.
 * Re-fetches whenever a save could have changed the list (mount,
 * `currentProjectId`, or `lastSavedAt` changing) — a cheap DB query, no
 * AI cost involved.
 *
 * Rendered in two places (the blank home screen and the workspace's first
 * column) — this one component, so the list's height cap lives here once. The
 * list is capped and scrolls inside itself, and keeps the open project in view
 * (see the effect below) since with enough projects it can sit below the fold.
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshProjectList();
  }, [refreshProjectList, currentProjectId, lastSavedAt]);

  // Bring the open project into view — once it changes or the list (re)loads,
  // NOT on every refresh: the list re-fetches on each save, and snapping back
  // to the open project each time would fight someone browsing the rest of it.
  // Scrolls only this list, by the smallest amount that shows the row.
  useEffect(() => {
    const list = listRef.current;
    if (!list || currentProjectId === null) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-project-id]")).find(
      (el) => el.dataset.projectId === currentProjectId,
    );
    if (!row) return;
    list.scrollTop = scrollTopToReveal({
      scrollTop: list.scrollTop,
      viewHeight: list.clientHeight,
      itemTop: row.offsetTop,
      itemHeight: row.offsetHeight,
    });
    // Keyed on `projects.length`, not `projects`: see above.
  }, [currentProjectId, projects.length]);

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

      {/* `relative` so rows' offsetTop is measured from THIS box (the reveal
          effect above); `overscroll-contain` so reaching the end of the list
          doesn't start scrolling the page; the height is capped by the
          viewport too, so on a short window the card doesn't take the screen. */}
      <div
        ref={listRef}
        className="relative mt-3 flex max-h-[min(14rem,40vh)] min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
      >
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
              data-project-id={p.id}
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
