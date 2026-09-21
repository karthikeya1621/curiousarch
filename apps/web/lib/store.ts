import { create } from "zustand";
import type { AiFinding, Component, SystemModel } from "@archsim/engine";
import {
  loadProject,
  saveProject,
  listProjects,
  deleteProject,
  type AppliedFixRecord,
  type ChatMessage,
  type PendingFix,
  type ProjectSummary,
  type SavedSession,
  type Version,
} from "./sessionStorage";

export type { AppliedFixRecord, PendingFix, ProjectSummary, Version };

/**
 * Which project to reopen on next visit — deliberately NOT in the
 * database: it's disposable UI state ("which tab was I on"), not project
 * data. Losing it just means the app shows the blank canvas + project
 * list instead of auto-resuming, same graceful degradation as any other
 * missing-session path here. All real project content is 100% Postgres.
 */
const LAST_PROJECT_KEY = "archsim:last-project-id";

function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function setLastProjectId(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
    else localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Best-effort convenience pointer — a private window or blocked site
    // data just means the next visit starts from the project list again.
  }
}

/**
 * Blank canvas is the actual starting state — no preset system, no
 * controls, nothing to describe yet. `workload: {}` is valid since every
 * field on `Workload` is optional (see @archsim/engine's types.ts).
 */
const EMPTY_MODEL: SystemModel = {
  id: "blank",
  name: "",
  components: [],
  edges: [],
  workload: {},
};

/**
 * How many prior chat messages (~4 exchanges) get sent as context on the
 * next one. Bounded, not the full transcript: unbounded history means
 * the request keeps growing every message for the life of a session —
 * exactly the kind of cost creep this project has been actively cutting
 * elsewhere. Enough for a real follow-up ("why is that?") to make sense;
 * older context quietly drops off rather than being resent forever.
 */
const CHAT_HISTORY_WINDOW = 8;

/**
 * Sequencing for async work that writes back into the store after an
 * `await` (findings, chat, opening a project). Without these, a slow
 * response lands in whatever project happens to be open by then — e.g. a
 * chat change requested in project A getting applied to (and autosaved
 * into) project B after the user switched.
 *
 * - `sessionEpoch` bumps whenever the open project/build is replaced;
 *   anything started under an older epoch is dropped on arrival.
 * - `findingsSeq` bumps per `refreshFindings` call; within one epoch only
 *   the most recent call may update `findings`, so an older response
 *   (e.g. an older Re-simulate's result arriving after a newer one's) can't
 *   overwrite newer state.
 * - `openSeq` bumps per project open, so of two rapid clicks the LAST one
 *   wins rather than whichever network response happens to land last.
 */
let sessionEpoch = 0;
let findingsSeq = 0;
let openSeq = 0;

/**
 * Findings are AI-generated now (`identifyFailures`), not computed — see
 * packages/engine/README.md and CONTEXT.md for the explicit product
 * decision behind this. They live here, not in a hook, because the
 * diagram (badge counts) and the sidebar (the actual list) both need the
 * same fetched result, and fetching is async — unlike the old
 * `useScenarios`/`useFixes`, which were synchronous `useMemo`s over a
 * deterministic function call.
 *
 * `refreshFindings` is NOT called from every model change — only from
 * `setModel`/`commitRework`, the two actions that themselves represent
 * "the user asked to see the current state of a system" (a fresh build,
 * or a completed Re-simulate). `setWorkloadTier` and `applyFix`
 * deliberately do NOT trigger it: moving the tier slider or applying a
 * fix (including a chat-driven change, which commits through `applyFix`
 * too) is a change to review, not an automatic request for the AI's
 * opinion — that's what the Re-simulate button is for. Every live
 * inference call costs real money, so this is a deliberate cost/
 * freshness tradeoff, not an oversight: `findings` visibly goes stale
 * relative to `model` after any of these, and that's the intended signal
 * to click Re-simulate, not a bug to paper over with an automatic call.
 *
 * `canResimulate` starts `false` and flips `true` on `setWorkloadTier`/
 * `applyFix` (something changed since the last review) and back to
 * `false` on `setModel`/`commitRework` (nothing has changed yet either
 * way — a fresh build or a just-finished rework has nothing new to
 * reconsider).
 */
interface AppState {
  model: SystemModel;
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  openComponentId: string | null;
  selectedFindingId: string | null;
  selectedFixId: string | null;
  canResimulate: boolean;
  /**
   * True specifically since a workload-tier control moved, reset once a
   * Re-simulate (or restoring a version) addresses it — narrower than
   * `canResimulate`, which also flips true for a queued fix or an applied/
   * chat-driven change, and can't by itself tell those apart. Exists so
   * `ResimulateButton.tsx` can show a "parameters changed" note
   * specifically for a tier move, independent of (and alongside) its
   * separate "N fixes queued" note — the two are not mutually exclusive,
   * both can be true at once, and conflating them under `canResimulate`
   * alone made the parameter-change note disappear whenever a fix was
   * also queued.
   */
  parametersChangedSinceResimulate: boolean;
  /**
   * The model the current `findings` describe: set by a fresh build, a
   * Re-simulate, restoring a version, loading a project, and again whenever a
   * findings refresh lands (that refresh IS "findings now match this model").
   *
   * Everything about "what's pending" is DERIVED from comparing the live
   * `model` against this (see `derivePending`), rather than latched by each
   * action as it happens. Latched flags could only ever go true — moving a
   * tier slider back to where it started, or pressing Reset, left the "Updates"
   * panel, the enabled Re-simulate button and the pending caption all stuck
   * on for a change that no longer existed, and with billing per simulation
   * that would let someone pay for a no-op. `null` only for a project saved
   * before this existed and still carrying pending changes; those keep the
   * old latched behavior until their next Re-simulate sets a baseline.
   */
  baselineModel: SystemModel | null;
  /**
   * Same pattern as `parametersChangedSinceResimulate`, for the other
   * source `canResimulate` can't itself distinguish: the architecture
   * (components/edges) differs from `baselineModel`. In practice that's a
   * chat-driven change — `FindingPanel.tsx` only ever queues fixes, so no
   * other live path edits the architecture directly.
   */
  chatChangeSinceResimulate: boolean;
  /**
   * True once the model has changed (a raised tier, an applied fix, a
   * chat-driven change) without `findings` having been recomputed for it
   * yet — the dashboard mutes the findings list and shows a caption while
   * this is true, since otherwise a stale and a fresh findings list are
   * visually identical. Set by `setWorkloadTier`/`applyFix`; only a
   * successful `refreshFindings` (from `setModel`/`commitRework`) clears
   * it, since that's the only thing that makes `findings` actually match
   * `model` again.
   */
  findingsStale: boolean;
  lastSavedAt: number | null;
  /** False until the initial DB fetch (hydrateFromStorage) completes — lets page.tsx show a brief loading state instead of flashing the blank canvas while that network call is in flight. */
  hydrated: boolean;
  /**
   * Bumped by every action AutoSaveIndicator.tsx should actually persist —
   * a fresh build, a chat-driven change, queueing/unqueueing a fix, a
   * Reset, restoring a version, a completed Re-simulate. Deliberately NOT
   * bumped by `setWorkloadTier`: moving the tier slider is a parameter
   * change to review, not something to save (or redraw the canvas for —
   * see FlowDiagram.tsx's own comment) on its own; only an explicit
   * Re-simulate commits it. Watching this instead of `model` directly is
   * what lets AutoSaveIndicator tell those two kinds of model change apart
   * without needing to inspect what actually changed.
   */
  autosaveRevision: number;
  /** Which saved project (if any) Save/Re-simulate write to. `null` = unsaved — the next Save inserts a new row instead of updating one. */
  currentProjectId: string | null;
  /** The logged-in user's saved projects, for ProjectsDropdown — not kept in sync automatically; refreshProjectList() re-fetches it. */
  projects: ProjectSummary[];
  projectsStatus: "idle" | "loading" | "done";
  /**
   * The ongoing conversation for the CURRENT project — separate from
   * `findings`, never wiped by a rework/fix/reset (those change the
   * architecture; the conversation about it continues alongside that).
   * Only `setModel`/`startNewProject` reset it, since those mean "this is
   * a different project now."
   */
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "loading";
  chatError: string | null;
  /**
   * A log of fixes actually applied, not derived from the model — kept
   * even if a later change reverts one (same relationship a git log has to
   * `git revert`), so a component's modal can show its history honestly. Only
   * the formal finding->fix flow (`FindingPanel`) records an entry; a
   * chat-driven change can't be reliably attributed to one component
   * without diffing the model, so it doesn't.
   */
  appliedFixes: AppliedFixRecord[];
  /**
   * Fixes chosen but not yet implemented — "Apply this fix" no longer
   * calls the AI immediately (that used to cost a live call on every
   * single click); it queues the choice here instead, and Re-simulate is
   * what actually sends it to the AI (as explicit context, alongside its
   * own holistic review) and implements it. Only one queued entry per
   * finding (matched by componentId + findingTitle, same key
   * isFindingFixed.ts already uses for `appliedFixes`): picking a
   * different fix for the same finding replaces the earlier choice
   * rather than sending the AI two conflicting instructions for it.
   * Cleared (moved
   * into `appliedFixes`) by a successful `commitRework` — never by
   * anything else, so queuing several fixes and resimulating once is the
   * normal, cheaper way to use this.
   */
  pendingFixes: PendingFix[];
  /**
   * The component object behind the currently-open detail modal — an
   * object, not just an id, so it works correctly whether the diagram on
   * screen is the live model or a previewed past version (see
   * `previewVersionId`): whichever was actually clicked is what's shown.
   */
  viewingComponent: Component | null;
  /**
   * A checkpoint recorded on the initial build and every completed
   * Re-simulate (never on a fix or tier change). Only ever grows: browsing or
   * restoring an old version never removes anything from this list,
   * which is exactly why "read-only preview + explicit restore" is safe.
   */
  versions: Version[];
  /** Which version (if any) is being browsed read-only. `null` = viewing the live model. */
  previewVersionId: string | null;
  setModel: (model: SystemModel) => void;
  setWorkloadTier: (dimension: "users" | "requests", tier: number) => void;
  applyFix: (newModel: SystemModel, appliedFix?: AppliedFixRecord) => void;
  /** Queues a fix for the next Re-simulate — no AI call, no model change yet. Replaces any existing queued fix for the same finding. */
  queueFix: (pendingFix: PendingFix) => void;
  /** Removes a queued fix before Re-simulate runs. */
  unqueueFix: (componentId: string, findingTitle: string) => void;
  commitRework: (newModel: SystemModel) => void;
  /**
   * Puts the workload controls back to the values the last simulation used
   * (`baselineModel.workload`). Purely local — no API call, no version, no
   * findings refresh: it only discards unsimulated control changes, and what's
   * "pending" is re-derived from the comparison. Leaves a chat change and any
   * queued fixes alone; those have their own controls.
   */
  revertParameters: () => void;
  setOpenComponentId: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  selectFix: (id: string | null) => void;
  openComponentDetail: (component: Component) => void;
  closeComponentDetail: () => void;
  previewVersion: (id: string | null) => void;
  /** Makes a past version live again. Never touches `versions` itself — so the current, unsimulated state isn't recoverable afterwards unless it was itself a version (PreviewBanner.tsx confirms first when there's unsimulated state to lose). */
  restoreVersion: (id: string) => void;
  /** Reopens the last-viewed project (see the local `archsim:last-project-id` pointer), if any — a no-op otherwise. */
  hydrateFromStorage: () => Promise<void>;
  /** Saves the current session to `currentProjectId`, or inserts a new project if it's `null`. Resolves false (not logged in, RLS rejection, network error) so the caller can show that instead of a false "Saved". */
  saveToStorage: () => Promise<boolean>;
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
  /** Loads a saved project and makes it the live one, updating `currentProjectId` and the last-viewed pointer. */
  openProject: (id: string) => Promise<void>;
  /** Deletes a saved project. If it was the open one, resets to a blank canvas (like `startNewProject`). */
  deleteProjectById: (id: string) => Promise<void>;
  /** A free-text message about the current project — answered, or turned into an actual model change, by the AI itself (see chatWithProject.ts). */
  sendChatMessage: (message: string) => Promise<void>;
}

/**
 * Shared by `hydrateFromStorage` and `openProject` — both turn a
 * `SavedSession` fetched from the database into the same set of live
 * fields; `currentProjectId` is set by each caller separately since one
 * knows it from a pointer and the other from its own argument.
 */
function sessionToState(session: SavedSession): Partial<AppState> {
  const versions = session.versions ?? [];
  const pendingFixes = session.pendingFixes ?? [];
  // The model the findings describe. Saved with the project from now on; for
  // one saved before that existed, recover it: every Build and Re-simulate
  // records a version of exactly the model it analyzed, so the newest version
  // IS the last simulation's model. Only a project with neither — nothing
  // simulated yet, or a build whose findings never landed — falls back to
  // "current model, if nothing was pending" or, failing that, null (which
  // keeps the old latched behavior until its next Re-simulate). Not
  // recovering it left an older project with a pending flag that nothing
  // could clear: Reset was disabled (no baseline) while the notes still said
  // "Parameters changed".
  const baselineModel =
    session.baselineModel ??
    (versions.at(-1)?.model ?? (session.canResimulate || session.findingsStale ? null : session.model));
  return {
    model: session.model,
    findings: session.findings,
    // A save can never be mid-flight ("loading") by the time it's read
    // back — there's no request left to resume, so treat it as settled.
    findingsStatus: session.findingsStatus === "loading" ? "done" : session.findingsStatus,
    findingsError: session.findingsError,
    canResimulate: session.canResimulate,
    // `?? false` covers a session saved before this field existed.
    parametersChangedSinceResimulate: session.parametersChangedSinceResimulate ?? false,
    chatChangeSinceResimulate: session.chatChangeSinceResimulate ?? false,
    baselineModel,
    findingsStale: session.findingsStale ?? false,
    // Re-derived from the data whenever there's a baseline, overriding the
    // persisted flags: what's pending is a fact about model vs baseline, so a
    // saved flag that disagrees (an older project's latched one) is just wrong.
    ...derivePending(session.model, baselineModel, pendingFixes),
    lastSavedAt: session.savedAt,
    // `?? []` covers a session saved before chat/fixes/versions existed.
    chatMessages: session.chatMessages ?? [],
    appliedFixes: session.appliedFixes ?? [],
    pendingFixes: session.pendingFixes ?? [],
    versions: session.versions ?? [],
    chatStatus: "idle",
    chatError: null,
    openComponentId: null,
    selectedFindingId: null,
    selectedFixId: null,
    viewingComponent: null,
    previewVersionId: null,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * What's pending, computed from the live model vs the model the findings
 * describe — so it reflects the CURRENT difference, not the history of how
 * it got there (moving a slider back clears it). Returns `null` when there
 * is no baseline to compare against; callers then fall back to latching.
 *
 * `findingsStale` means exactly "findings don't match the model" — a queued
 * fix alone doesn't change the model, so it makes Re-simulate available
 * (`canResimulate`) without making the findings stale.
 */
function derivePending(model: SystemModel, baseline: SystemModel | null, pendingFixes: PendingFix[]) {
  if (!baseline) return null;
  const parametersChanged = !deepEqual(model.workload, baseline.workload);
  const architectureChanged =
    !deepEqual(model.components, baseline.components) || !deepEqual(model.edges, baseline.edges);
  return {
    parametersChangedSinceResimulate: parametersChanged,
    chatChangeSinceResimulate: architectureChanged,
    findingsStale: parametersChanged || architectureChanged,
    canResimulate: parametersChanged || architectureChanged || pendingFixes.length > 0,
  };
}

/**
 * Every per-project field in its blank state — the single source for the
 * store's initial state, a fresh build (`setModel`), and starting a new
 * project. A function (fresh arrays each call) rather than a shared
 * constant so no two resets ever hand out the same array instance.
 * Previously this list was written out by hand in each of those places, so
 * adding one field meant editing all of them (and forgetting one silently
 * left stale state behind).
 */
function emptySession() {
  return {
    findings: [] as AiFinding[],
    findingsStatus: "idle" as const,
    findingsError: null,
    findingsStale: false,
    openComponentId: null,
    selectedFindingId: null,
    selectedFixId: null,
    canResimulate: false,
    parametersChangedSinceResimulate: false,
    chatChangeSinceResimulate: false,
    chatMessages: [] as ChatMessage[],
    chatStatus: "idle" as const,
    chatError: null,
    appliedFixes: [] as AppliedFixRecord[],
    pendingFixes: [] as PendingFix[],
    viewingComponent: null,
    versions: [] as Version[],
    previewVersionId: null,
    baselineModel: null as SystemModel | null,
  } satisfies Partial<AppState>;
}

async function refreshFindings(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<void> {
  // Claimed before anything else (including the empty-model early return)
  // so a still-in-flight older call can never overwrite this one's state.
  const epoch = sessionEpoch;
  const seq = ++findingsSeq;
  const { model } = get();
  if (model.components.length === 0) {
    set({ findings: [], findingsStatus: "idle", findingsError: null, findingsStale: false });
    return;
  }
  set({ findingsStatus: "loading", findingsError: null });
  try {
    const res = await fetch("/api/identify-failures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to identify failures.");
    const findings = body.findings as AiFinding[];
    // The open project/build was replaced while this was in flight — its
    // findings (and version snapshot) belong to a session that's gone.
    if (epoch !== sessionEpoch) return;
    const isLatest = seq === findingsSeq;
    set((state) => ({
      // Only the most recent call updates what's on screen; a superseded
      // one still records its version below (that snapshot is valid for
      // the `model` it analyzed regardless of what's live now). The
      // findings now describe `model`, so that becomes the baseline — and
      // what's pending is re-derived against the LIVE model, which may have
      // moved on while this was in flight (previously this just declared
      // the findings fresh, wrongly, if a tier had been moved meanwhile).
      ...(isLatest
        ? {
            findings,
            findingsStatus: "done" as const,
            baselineModel: model,
            ...derivePending(state.model, model, state.pendingFixes),
          }
        : {}),
      // `model` — the value fetched against, captured before the `await`
      // above — not `state.model`, which may have moved on since.
      versions: [...state.versions, { id: crypto.randomUUID(), model, findings, createdAt: Date.now() }],
      // Findings (and a recorded version) are part of what gets saved, but
      // Build/Re-simulate bump the counter when they START — while these
      // are still loading — so the debounced save captured the OLD
      // findings and, after a Re-simulate, `findingsStale: true`. Without
      // this, that row was never corrected, and reopening the project
      // showed "Based on the previous version…" for one that had just
      // been re-simulated. (The old autosave watched `versions`, which is
      // what used to cover this.) Skipped when nothing here changed state.
      autosaveRevision: state.autosaveRevision + 1,
    }));
  } catch (err) {
    if (epoch !== sessionEpoch || seq !== findingsSeq) return;
    set({
      findingsStatus: "done",
      findingsError: err instanceof Error ? err.message : "Failed to identify failures.",
    });
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  ...emptySession(),
  model: EMPTY_MODEL,
  lastSavedAt: null,
  hydrated: false,
  autosaveRevision: 0,
  currentProjectId: null,
  projects: [],
  projectsStatus: "idle",

  setModel: (model) => {
    sessionEpoch++;
    set({
      ...emptySession(),
      model,
      baselineModel: model,
      autosaveRevision: get().autosaveRevision + 1,
    });
    void refreshFindings(set, get);
  },

  setWorkloadTier: (dimension, tier) => {
    const { model } = get();
    const current = model.workload[dimension];
    if (!current) return;
    // Deliberately does NOT bump autosaveRevision — a parameter change is
    // something to review, not to persist (or redraw the canvas for — see
    // FlowDiagram.tsx's own comment on why it depends on
    // model.components/model.edges rather than model itself) on its own;
    // only an explicit Re-simulate commits it. See this field's own doc
    // comment on AppState.
    const next = { ...model, workload: { ...model.workload, [dimension]: { ...current, tier } } };
    const { baselineModel, pendingFixes } = get();
    const derived = derivePending(next, baselineModel, pendingFixes);
    set({
      model: next,
      // Derived, so moving a tier back to where it started clears it. With
      // no baseline (a legacy project), fall back to latching it on.
      ...(derived ?? {
        canResimulate: true,
        parametersChangedSinceResimulate: true,
        findingsStale: true,
      }),
      // Only when the controls land back on the baseline: a save that
      // happened while they were changed (a queued fix bumps the counter
      // too) would otherwise leave the changed values persisted, and
      // reloading would show a parameter change that was already reverted.
      ...(derived && !derived.parametersChangedSinceResimulate
        ? { autosaveRevision: get().autosaveRevision + 1 }
        : {}),
    });
  },

  applyFix: (newModel, appliedFix) => {
    const { appliedFixes, chatChangeSinceResimulate, baselineModel, pendingFixes } = get();
    set({
      model: newModel,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      // Not refreshed here — same as setWorkloadTier, this only marks
      // findings stale and waits for an explicit Re-simulate click, rather
      // than spending an identifyFailures call on every single fix/chat
      // change. See this file's own top comment. Derived from the baseline
      // (so it can be undone away); with none (a legacy project), latched:
      // stale + Re-simulate available, and — only when `appliedFix` is
      // absent, i.e. a chat change — the chat flag set, never cleared.
      ...(derivePending(newModel, baselineModel, pendingFixes) ?? {
        canResimulate: true,
        chatChangeSinceResimulate: appliedFix ? chatChangeSinceResimulate : true,
        findingsStale: true,
      }),
      appliedFixes: appliedFix ? [...appliedFixes, appliedFix] : appliedFixes,
      autosaveRevision: get().autosaveRevision + 1,
    });
  },

  queueFix: (pendingFix) => {
    const { pendingFixes } = get();
    const withoutExisting = pendingFixes.filter(
      (p) => !(p.componentId === pendingFix.componentId && p.findingTitle === pendingFix.findingTitle),
    );
    set({
      pendingFixes: [...withoutExisting, pendingFix],
      canResimulate: true,
      autosaveRevision: get().autosaveRevision + 1,
    });
  },

  unqueueFix: (componentId, findingTitle) => {
    const { model, pendingFixes, baselineModel } = get();
    const remaining = pendingFixes.filter(
      (p) => !(p.componentId === componentId && p.findingTitle === findingTitle),
    );
    set({
      pendingFixes: remaining,
      autosaveRevision: get().autosaveRevision + 1,
      // Re-simulate stays available only if something ELSE still warrants
      // it (a tier change, a chat change, another queued fix) — this used
      // to be left alone because there was no way to tell, which kept an
      // enabled (and soon billable) button with nothing left to do. With
      // no baseline (a legacy project) it's still left alone.
      ...(baselineModel ? { canResimulate: derivePending(model, baselineModel, remaining)!.canResimulate } : {}),
    });
  },

  commitRework: (newModel) => {
    const { appliedFixes, pendingFixes } = get();
    const nowApplied: AppliedFixRecord[] = pendingFixes.map((p) => ({
      componentId: p.componentId,
      findingTitle: p.findingTitle,
      fixLabel: p.fixLabel,
      appliedAt: Date.now(),
    }));
    set({
      model: newModel,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
      parametersChangedSinceResimulate: false,
      chatChangeSinceResimulate: false,
      baselineModel: newModel,
      // Every queued fix just got sent to the AI as explicit context (see
      // ResimulateButton.tsx) — whether or not the result perfectly
      // reflects it, it's no longer "pending"; if identifyFailures (run
      // right below) still finds the underlying issue, it'll simply
      // reappear as a fresh, current, re-queueable finding.
      pendingFixes: [],
      appliedFixes: [...appliedFixes, ...nowApplied],
      autosaveRevision: get().autosaveRevision + 1,
    });
    void refreshFindings(set, get);
  },

  revertParameters: () => {
    const { model, baselineModel, pendingFixes } = get();
    if (!baselineModel) return;
    const next = { ...model, workload: baselineModel.workload };
    set({
      model: next,
      // Re-derived rather than blanket-cleared: a chat change or queued fix
      // made alongside the parameters is still pending afterwards.
      ...derivePending(next, baselineModel, pendingFixes)!,
      // Persist the reverted state (see setWorkloadTier for why).
      autosaveRevision: get().autosaveRevision + 1,
    });
  },

  setOpenComponentId: (id) => set({ openComponentId: id, selectedFindingId: null, selectedFixId: null }),

  selectFinding: (id) => set({ selectedFindingId: id, selectedFixId: null }),

  selectFix: (id) => set({ selectedFixId: id }),

  openComponentDetail: (component) => set({ viewingComponent: component }),

  closeComponentDetail: () => set({ viewingComponent: null }),

  previewVersion: (id) => set({ previewVersionId: id }),

  restoreVersion: (id) => {
    const { versions } = get();
    const version = versions.find((v) => v.id === id);
    if (!version) return;
    // Any findings request still in flight was for the state being
    // replaced — it must not overwrite the restored version's own findings.
    findingsSeq++;
    set({
      model: version.model,
      findings: version.findings,
      findingsStatus: "done",
      findingsError: null,
      findingsStale: false,
      canResimulate: false,
      parametersChangedSinceResimulate: false,
      chatChangeSinceResimulate: false,
      baselineModel: version.model,
      // Any queued fixes were chosen against the state being replaced —
      // they no longer refer to anything meaningful once it's gone.
      pendingFixes: [],
      previewVersionId: null,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      autosaveRevision: get().autosaveRevision + 1,
    });
  },

  hydrateFromStorage: async () => {
    const lastId = getLastProjectId();
    if (!lastId) {
      set({ hydrated: true });
      return;
    }
    const openId = ++openSeq;
    const session = await loadProject(lastId);
    // The user opened/created something else while this was loading —
    // that choice wins; this stale auto-resume must not overwrite it.
    if (openId !== openSeq) {
      set({ hydrated: true });
      return;
    }
    if (!session) {
      // The pointer is stale (deleted elsewhere, RLS denied, etc.) — drop
      // it rather than retrying it forever.
      setLastProjectId(null);
      set({ hydrated: true });
      return;
    }
    sessionEpoch++;
    set({ ...sessionToState(session), currentProjectId: lastId, hydrated: true });
  },

  saveToStorage: async () => {
    const {
      currentProjectId,
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
      versions,
    } = get();
    const saved = await saveProject(currentProjectId, {
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
      versions,
    });
    if (saved) {
      set({ lastSavedAt: saved.savedAt, currentProjectId: saved.id });
      setLastProjectId(saved.id);
    }
    return saved !== null;
  },

  startNewProject: () => {
    setLastProjectId(null);
    // Abandons everything still in flight for the project being left: a
    // pending open, and any findings/chat response that would otherwise
    // land in the blank project.
    sessionEpoch++;
    openSeq++;
    set({
      ...emptySession(),
      model: EMPTY_MODEL,
      currentProjectId: null,
    });
  },

  refreshProjectList: async () => {
    set({ projectsStatus: "loading" });
    const projects = await listProjects();
    set({ projects: projects ?? [], projectsStatus: "done" });
  },

  openProject: async (id) => {
    const openId = ++openSeq;
    const session = await loadProject(id);
    // A failed load, or a newer open/new-project that superseded this
    // one while it was loading (last click wins, not last response).
    if (!session || openId !== openSeq) return;
    setLastProjectId(id);
    // Bumped only now that the switch is actually happening — a failed
    // load must not orphan the current project's in-flight findings.
    sessionEpoch++;
    set({ ...sessionToState(session), currentProjectId: id });
  },

  deleteProjectById: async (id) => {
    const ok = await deleteProject(id);
    if (!ok) return;
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
    if (get().currentProjectId === id) {
      get().startNewProject();
    }
  },

  sendChatMessage: async (message) => {
    const { model, chatMessages, findings, pendingFixes } = get();
    const epoch = sessionEpoch;
    // Bounded window, not the full transcript — see this file's own
    // comment on CHAT_HISTORY_WINDOW: unbounded history is exactly the
    // kind of cost creep this project has been actively cutting elsewhere.
    const history = chatMessages
      .slice(-CHAT_HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.text }));
    set({
      chatMessages: [...chatMessages, { role: "user", text: message }],
      chatStatus: "loading",
      chatError: null,
    });
    try {
      // `findings`/`pendingFixes` are what the dashboard is showing right
      // now — passed so chat's answers stay grounded in exactly that, not
      // a version it re-derives fresh from the raw model alone. Same
      // "send the full store shape, the API route narrows it" pattern
      // ResimulateButton.tsx already uses for `pendingFixes`.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, message, history, findings, pendingFixes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Chat failed.");
      // The project was switched or reset while this was in flight — the
      // reply belongs to a session that's no longer open. (The switch
      // itself already reset chat status.)
      if (epoch !== sessionEpoch) return;

      const changedModel = body.model as SystemModel | undefined;
      // The AI built `changedModel` from the `model` it was sent. If the
      // live model moved on during the wait (a tier change, a Reset…),
      // applying it would silently discard that edit — so the change is
      // withheld and the user is told, rather than clobbering their work.
      const superseded = changedModel !== undefined && get().model !== model;
      const replyText = superseded
        ? `${body.reply as string} — Not applied: the system changed while this was running. Ask again to apply it to the current version.`
        : (body.reply as string);
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          { role: "assistant", text: replyText, changed: changedModel !== undefined && !superseded },
        ],
        chatStatus: "idle",
        // A plain Q&A answer never touches `model`, so nothing else here
        // would bump this — worth persisting anyway so the conversation
        // survives a reload. A model-changing reply bumps it again via
        // `applyFix` just below, which is harmless (the indicator only
        // cares that this changed, not by how much).
        autosaveRevision: state.autosaveRevision + 1,
      }));
      // A change request — commit it exactly like applying a fix: clear
      // stale selections, mark findings stale, and
      // enable Re-simulate (which is what will actually refresh findings,
      // if and when the user clicks it — no identifyFailures call here).
      if (changedModel && !superseded) get().applyFix(changedModel);
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      set({ chatStatus: "idle", chatError: err instanceof Error ? err.message : "Chat failed." });
    }
  },
}));
