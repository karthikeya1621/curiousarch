import type { AiFinding, SystemModel } from "@archsim/engine";
import type {
  AppliedFixRecord,
  ChatMessage,
  PendingChatChange,
  PendingFix,
  SavedSession,
  Version,
} from "../sessionStorage";
import { derivePending } from "./pending";
import type { AppState } from "./types";

/**
 * Which project to reopen on next visit — deliberately NOT in the
 * database: it's disposable UI state ("which tab was I on"), not project
 * data. Losing it just means the app shows the blank canvas + project
 * list instead of auto-resuming, same graceful degradation as any other
 * missing-session path here. All real project content is 100% Postgres.
 */
const LAST_PROJECT_KEY = "archsim:last-project-id";

export function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(id: string | null) {
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
export const EMPTY_MODEL: SystemModel = {
  id: "blank",
  name: "",
  components: [],
  edges: [],
  workload: {},
};

/**
 * Every per-project field in its blank state — the single source for the
 * store's initial state, a fresh build (`setModel`), and starting a new
 * project. A function (fresh arrays each call) rather than a shared
 * constant so no two resets ever hand out the same array instance.
 * Previously this list was written out by hand in each of those places, so
 * adding one field meant editing all of them (and forgetting one silently
 * left stale state behind).
 */
export function emptySession() {
  return {
    findings: [] as AiFinding[],
    findingsStatus: "idle" as const,
    findingsError: null,
    findingsStale: false,
    reworkWarning: null,
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
    pendingChanges: [] as PendingChatChange[],
    viewingComponent: null,
    versions: [] as Version[],
    previewVersionId: null,
    baselineModel: null as SystemModel | null,
  } satisfies Partial<AppState>;
}

/** The id AI usage is filed under for the project on screen — saved id if it has one, else the one it will be saved with. */
export function usageProjectIdOf(state: Pick<AppState, "currentProjectId" | "draftProjectId">): string {
  return state.currentProjectId ?? state.draftProjectId;
}

/**
 * Shared by `hydrateFromStorage` and `openProject` — both turn a
 * `SavedSession` fetched from the database into the same set of live
 * fields; `currentProjectId` is set by each caller separately since one
 * knows it from a pointer and the other from its own argument.
 */
export function sessionToState(session: SavedSession): Partial<AppState> {
  const versions = session.versions ?? [];
  const pendingFixes = session.pendingFixes ?? [];
  const pendingChanges = session.pendingChanges ?? [];
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
    ...derivePending(session.model, baselineModel, pendingFixes, pendingChanges),
    lastSavedAt: session.savedAt,
    // `?? []` covers a session saved before chat/fixes/versions existed.
    chatMessages: session.chatMessages ?? [],
    appliedFixes: session.appliedFixes ?? [],
    pendingFixes,
    pendingChanges,
    versions,
    chatStatus: "idle",
    chatError: null,
    openComponentId: null,
    selectedFindingId: null,
    selectedFixId: null,
    viewingComponent: null,
    previewVersionId: null,
  };
}
