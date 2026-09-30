import { loadProject, saveProject, listProjects, deleteProject, type ProjectSummary } from "../../sessionStorage";
import { sequence } from "../sequencing";
import { EMPTY_MODEL, emptySession, getLastProjectId, sessionToState, setLastProjectId } from "../session";
import type { StoreGet, StoreSet } from "../types";

/**
 * How an attempt to open a project ended. `superseded` is NOT a failure of the
 * project: a newer open (another click, another link) took over while this one
 * loaded, and that newer one now decides what's on screen. Callers that show a
 * "not found" message must not show it for `superseded`.
 */
export type OpenResult = "opened" | "not-found" | "superseded";

/** Which project is open, whether it's been saved, and the list of the user's projects. */
export interface ProjectState {
  lastSavedAt: number | null;
  /** False until the initial DB fetch (hydrateFromStorage) completes — lets page.tsx show a brief loading state instead of flashing the blank canvas while that network call is in flight. */
  hydrated: boolean;
  /**
   * Bumped by every action AutoSaveIndicator.tsx should actually persist —
   * a fresh build, a chat reply (a queued change or not), queueing/unqueueing a
   * fix or chat change, a Reset, restoring a version, a completed Re-simulate.
   * Deliberately NOT bumped by `setWorkloadTier`: moving the tier slider is a
   * parameter change to review, not something to save (or redraw the canvas
   * for — see FlowDiagram.tsx's own comment) on its own; only an explicit
   * Re-simulate commits it. Watching this instead of `model` directly is
   * what lets AutoSaveIndicator tell those two kinds of model change apart
   * without needing to inspect what actually changed.
   */
  autosaveRevision: number;
  /**
   * The `autosaveRevision` as of the last successful save or load — so "is
   * there anything the database doesn't have yet" is `autosaveRevision !==
   * savedRevision` (see `saveBeforeLeaving`). Advanced by the revision
   * captured when a save STARTS, not when it finishes: a change made while the
   * write was in flight leaves the two unequal, which is correct.
   */
  savedRevision: number;
  /**
   * The id a project that hasn't been saved yet WILL have once it is —
   * minted up front (and again on every `startNewProject`) so AI usage from
   * its very first Build can already be labelled with it, and used as the
   * row's id on first insert. Without this, a project's most expensive
   * action would have no project to attribute its cost to. Never sent
   * anywhere as an authority — see lib/usage/ids.ts.
   */
  draftProjectId: string;
  /** Which saved project (if any) Save/Re-simulate write to. `null` = unsaved — the next Save inserts a new row instead of updating one. */
  currentProjectId: string | null;
  /** The logged-in user's saved projects, for ProjectsDropdown — not kept in sync automatically; refreshProjectList() re-fetches it. */
  projects: ProjectSummary[];
  projectsStatus: "idle" | "loading" | "done" | "error";
}

export interface ProjectActions {
  /**
   * Restores a project on first load and marks the store `hydrated`. With no
   * argument it reopens the last-viewed project (the local
   * `archsim:last-project-id` pointer), if any; with an explicit id (a
   * `/project/<id>` deep link) it opens that one instead and ignores the
   * pointer. A failed explicit id leaves the pointer alone — one bad link
   * says nothing about the user's last project — whereas a stale pointer is
   * dropped. `not-found` also covers "nothing to restore" (no pointer).
   */
  hydrateFromStorage: (projectId?: string) => Promise<OpenResult>;
  /** Saves the current session to `currentProjectId`, or inserts a new project if it's `null`. Resolves false (not logged in, RLS rejection, network error) so the caller can show that instead of a false "Saved". */
  saveToStorage: () => Promise<boolean>;
  /**
   * Call before leaving the open project (starting a new one, opening
   * another): makes sure nothing is lost, without asking. Resolves true when
   * it's safe to go — the canvas is blank, nothing changed since the last
   * save, or a save just succeeded — and false only when a save was needed and
   * FAILED (offline, signed out), which is the one case worth telling the user
   * about. Autosave is debounced (1.5s), so there's a real window after a
   * change where leaving would otherwise drop it; this closes it, and also
   * saves a tier change, which deliberately doesn't trigger autosave itself.
   */
  saveBeforeLeaving: () => Promise<boolean>;
  /**
   * Discards the current session in memory and starts a blank one — the
   * only intentional way to abandon a project without saving it.
   * Clears `currentProjectId`, so the next Save inserts a new project
   * rather than overwriting whatever was open; never touches the
   * database itself, so a project you never explicitly saved is never
   * silently lost, and one you already saved stays exactly as it was.
   */
  startNewProject: () => void;
  /** Re-fetches the logged-in user's project list (for ProjectsDropdown). */
  refreshProjectList: () => Promise<void>;
  /** Loads a saved project and makes it the live one, updating `currentProjectId` and the last-viewed pointer. Resolves `not-found` if it couldn't be loaded (missing, not this user's) and `superseded` if a newer open took over while it loaded. */
  openProject: (id: string) => Promise<OpenResult>;
  /**
   * Deletes a saved project. If it was the open one, resets to a blank canvas (like `startNewProject`).
   * Resolves false on failure (network, RLS) — the project is left in the list rather than vanishing on
   * screen when nothing actually happened server-side; the caller shows this instead of a silent no-op.
   */
  deleteProjectById: (id: string) => Promise<boolean>;
}

export type ProjectSlice = ProjectState & ProjectActions;

export function createProjectActions(set: StoreSet, get: StoreGet): ProjectActions {
  return {
    hydrateFromStorage: async (projectId) => {
      const explicit = projectId !== undefined;
      const targetId = projectId ?? getLastProjectId();
      if (!targetId) {
        set({ hydrated: true });
        return "not-found";
      }
      const openId = ++sequence.open;
      const session = await loadProject(targetId);
      // The user opened/created something else while this was loading —
      // that choice wins; this stale auto-resume must not overwrite it.
      if (openId !== sequence.open) {
        set({ hydrated: true });
        return "superseded";
      }
      if (!session) {
        // The pointer is stale (deleted elsewhere, RLS denied, etc.) — drop
        // it rather than retrying it forever. An explicit id that failed is
        // just a bad link; it says nothing about the pointer.
        if (!explicit) setLastProjectId(null);
        set({ hydrated: true });
        return "not-found";
      }
      sequence.epoch++;
      if (explicit) setLastProjectId(targetId);
      set({
        ...sessionToState(session),
        currentProjectId: targetId,
        hydrated: true,
        savedRevision: get().autosaveRevision, // what was just loaded IS what's saved
      });
      return "opened";
    },

    saveBeforeLeaving: async () => {
      const s = get();
      if (s.model.components.length === 0) return true; // nothing to lose
      const unsaved =
        s.currentProjectId === null || // built but never saved
        s.autosaveRevision !== s.savedRevision ||
        // A moved tier isn't autosaved on its own (see `autosaveRevision`), but
        // it is part of what a save writes — and of what leaving would lose.
        s.parametersChangedSinceResimulate;
      if (!unsaved) return true;
      return s.saveToStorage();
    },

    saveToStorage: async () => {
      // The revision this save captures — anything bumped while it's in
      // flight is NOT covered by it (see `savedRevision`).
      const revisionAtSave = get().autosaveRevision;
      const {
        currentProjectId,
        draftProjectId,
        model,
        findings,
        findingsStatus,
        findingsError,
        canResimulate,
        parametersChangedSinceResimulate,
        chatChangeSinceResimulate,
        baselineModel,
        findingsStale,
        chatMessages,
        appliedFixes,
        pendingFixes,
        pendingChanges,
        versions,
      } = get();
      const saved = await saveProject(
        currentProjectId,
        {
          model,
          findings,
          findingsStatus: findingsStatus === "loading" ? "done" : findingsStatus,
          findingsError,
          canResimulate,
          parametersChangedSinceResimulate,
          chatChangeSinceResimulate,
          baselineModel,
          findingsStale,
          chatMessages,
          appliedFixes,
          pendingFixes,
          pendingChanges,
          versions,
        },
        draftProjectId,
      );
      if (saved) {
        set({ lastSavedAt: saved.savedAt, currentProjectId: saved.id, savedRevision: revisionAtSave });
        setLastProjectId(saved.id);
      }
      return saved !== null;
    },

    startNewProject: () => {
      setLastProjectId(null);
      // Abandons everything still in flight for the project being left: a
      // pending open, and any findings/chat response that would otherwise
      // land in the blank project.
      sequence.epoch++;
      sequence.open++;
      set({
        ...emptySession(),
        model: EMPTY_MODEL,
        currentProjectId: null,
        draftProjectId: crypto.randomUUID(),
      });
    },

    refreshProjectList: async () => {
      set({ projectsStatus: "loading" });
      const projects = await listProjects();
      // A failed fetch used to be stored as an empty list, identical to "you genuinely have none" - so a
      // real outage and an empty account looked the same, and the UI always said "no projects yet" even
      // when it just couldn't reach the database. On failure the STALE list is kept on screen (a blip
      // shouldn't make projects that were already loaded vanish) with the status saying why.
      if (projects === null) {
        set({ projectsStatus: "error" });
        return;
      }
      set({ projects, projectsStatus: "done" });
    },

    openProject: async (id) => {
      const openId = ++sequence.open;
      const session = await loadProject(id);
      // A newer open/new-project superseded this one while it was loading
      // (last click wins, not last response) — checked FIRST, since a
      // superseded attempt says nothing about whether the project exists.
      if (openId !== sequence.open) return "superseded";
      if (!session) return "not-found";
      setLastProjectId(id);
      // Bumped only now that the switch is actually happening — a failed
      // load must not orphan the current project's in-flight findings.
      sequence.epoch++;
      set({ ...sessionToState(session), currentProjectId: id, savedRevision: get().autosaveRevision });
      return "opened";
    },

    deleteProjectById: async (id) => {
      const ok = await deleteProject(id);
      if (!ok) return false;
      set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
      if (get().currentProjectId === id) {
        get().startNewProject();
      }
      return true;
    },
  };
}
