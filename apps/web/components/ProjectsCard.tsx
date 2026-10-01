"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import { timeAgo } from "../lib/timeAgo";
import { scrollTopToReveal } from "../lib/scrollTopToReveal";
import { PROJECT_ROW_GAP_REM, PROJECT_ROW_REM, projectListMaxHeightRem } from "../lib/projectListLayout";
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
 * column) — this one component, so the list's height lives here once: it shows
 * three and a half rows (lib/projectListLayout.ts) and scrolls inside itself,
 * the half row being the cue that there's more. It keeps the open project in
 * view (see the effect below) since with enough projects it can sit below the
 * fold.
 */
export function ProjectsCard({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const projects = useAppStore((s) => s.projects);
  const projectsStatus = useAppStore((s) => s.projectsStatus);
  const refreshProjectList = useAppStore((s) => s.refreshProjectList);
  const openProject = useAppStore((s) => s.openProject);
  const saveBeforeLeaving = useAppStore((s) => s.saveBeforeLeaving);
  const deleteProjectById = useAppStore((s) => s.deleteProjectById);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const isBlank = useAppStore((s) => s.model.components.length === 0);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // A Set/Map, not a single id/message: deleting two projects in quick succession with a single shared
  // value meant the second delete's `onConfirm` overwrote the first's in-flight state, so the first row's
  // spinner cleared early and its error (or success) could stomp on the second one's.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteErrors, setDeleteErrors] = useState<ReadonlyMap<string, string>>(new Map());
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

  async function handleRowClick(id: string) {
    if (id === currentProjectId) return;
    // The project being left is saved first (see `saveBeforeLeaving`), so this
    // doesn't ask — nothing is lost. Only a FAILED save is worth an
    // interruption, and only then is the confirmation shown.
    if (!isBlank && !(await saveBeforeLeaving())) {
      setPendingOpenId(id);
      return;
    }
    void openProject(id);
  }

  // The blank home screen has nothing to say to someone with no projects: the card still fetches the
  // list (the effects above ran) and appears once there is something in it.
  if (hideWhenEmpty && projects.length === 0) return null;

  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {hideWhenEmpty ? "Or pick up a project" : "Projects"}
        </h3>
        <NewProjectButton />
      </div>

      {/* `relative` so rows' offsetTop is measured from THIS box (the reveal
          effect above); `overscroll-contain` so reaching the end of the list
          doesn't start scrolling the page. Every row is the same fixed height
          and the cap is derived from it, so "3.5 rows" is exact. */}
      <div
        ref={listRef}
        style={{ maxHeight: `${projectListMaxHeightRem()}rem`, rowGap: `${PROJECT_ROW_GAP_REM}rem` }}
        className="relative mt-3 flex min-h-0 flex-col overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
      >
        {projectsStatus === "loading" && projects.length === 0 ? (
          <p role="status" className="px-1 py-1.5 text-xs text-slate-500 dark:text-slate-400">Loading…</p>
        ) : projectsStatus === "error" && projects.length === 0 ? (
          // Distinct from "no projects yet": a fetch failure must never look identical to an empty account.
          <div role="alert" className="flex items-center justify-between gap-2 px-1 py-1.5 text-xs text-rose-600 dark:text-rose-400">
            <span>Couldn&apos;t load your projects.</span>
            <button onClick={() => void refreshProjectList()} className="shrink-0 font-medium underline hover:no-underline">
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <p className="px-1 py-1.5 text-xs text-slate-500 dark:text-slate-400">
            Not saved yet — projects save automatically as you build.
          </p>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              data-project-id={p.id}
              style={{ height: `${PROJECT_ROW_REM}rem` }}
              className={
                "flex shrink-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors " +
                (p.id === currentProjectId
                  ? "bg-slate-50 dark:bg-slate-700"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700")
              }
            >
              <button
                onClick={() => void handleRowClick(p.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {p.id === currentProjectId ? (
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
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
                <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                  {timeAgo(p.updatedAt)}
                </span>
              </button>
              <button
                onClick={() => {
                  // Starting a fresh attempt on this row: its own stale error (if any) from a previous
                  // failed delete must not keep showing once the user is trying again.
                  setDeleteErrors((prev) => {
                    if (!prev.has(p.id)) return prev;
                    const next = new Map(prev);
                    next.delete(p.id);
                    return next;
                  });
                  setPendingDeleteId(p.id);
                }}
                disabled={deletingIds.has(p.id)}
                aria-label={deletingIds.has(p.id) ? "Deleting…" : "Delete project"}
                className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-60 dark:text-slate-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
              >
                <TrashIcon className={`h-3.5 w-3.5 ${deletingIds.has(p.id) ? "motion-safe:animate-pulse" : ""}`} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Below the fixed-height row list, not inside a row (a row's height is fixed for the "3.5 rows"
          scroll cue elsewhere in this card - wrapped error text wouldn't fit inside it). Named per project
          so two concurrent failed deletes are both visible and unambiguous, not just the last one. */}
      {deleteErrors.size > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {[...deleteErrors].map(([id, message]) => (
            <p key={id} role="alert" className="px-1 text-xs text-rose-600 dark:text-rose-400">
              {(projects.find((p) => p.id === id)?.name || "Untitled") + ": "}
              {message}
            </p>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingOpenId !== null}
        title="Couldn't save this project"
        message="Opening another project now would discard your latest changes. Stay to try again, or discard them and continue."
        confirmLabel="Discard and open"
        cancelLabel="Stay here"
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
          setDeletingIds((prev) => new Set(prev).add(id));
          // Fire-and-forget used to mean a failed delete just silently left the project sitting there with
          // no explanation - the user had no way to know their click hadn't worked. Each delete tracks only
          // its OWN id, so two running at once never clear or overwrite each other's state.
          void deleteProjectById(id).then((ok) => {
            setDeletingIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            if (!ok) {
              setDeleteErrors((prev) => new Map(prev).set(id, "Couldn't delete that project. Try again."));
            }
          });
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </Card>
  );
}
