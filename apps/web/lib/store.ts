import { create } from "zustand";
import type { AiFinding, Component, SystemModel } from "@archsim/engine";
import {
  loadSession,
  saveSession,
  type AppliedFixRecord,
  type ChatMessage,
  type PendingFix,
  type Version,
} from "./sessionStorage";

export type { AppliedFixRecord, PendingFix, Version };

/**
 * Blank canvas is the actual starting state — no preset system, no
 * controls, nothing to describe yet. The engine's own pattern functions
 * already handle zero components gracefully (confirmed by reading
 * solver.ts), so this needs no engine-side support; `workload: {}` is
 * valid since every field on `Workload` is optional now (see
 * @archsim/engine's types.ts).
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
  history: SystemModel[];
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  openComponentId: string | null;
  selectedFindingId: string | null;
  selectedFixId: string | null;
  canResimulate: boolean;
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
  /**
   * The ongoing conversation for the CURRENT project — separate from
   * `findings`, never wiped by a rework/fix/undo (those change the
   * architecture; the conversation about it continues alongside that).
   * Only `setModel`/`startNewProject` reset it, since those mean "this is
   * a different project now."
   */
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "loading";
  chatError: string | null;
  /**
   * A log of fixes actually applied, not derived from the model — kept
   * even across an Undo (same relationship a git log has to `git
   * revert`), so a component's modal can show its history honestly. Only
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
   * Re-simulate (never on a fix/tier-change/undo — those are the finer-
   * grained `history`/Undo stack's job). Only ever grows: browsing or
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
  undo: () => void;
  setOpenComponentId: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  selectFix: (id: string | null) => void;
  openComponentDetail: (component: Component) => void;
  closeComponentDetail: () => void;
  previewVersion: (id: string | null) => void;
  /** Makes a past version live again — pushes the current model onto `history` first, so it's one Undo away. Never touches `versions` itself. */
  restoreVersion: (id: string) => void;
  /** Restores the one saved session slot, if one exists — a no-op otherwise. */
  hydrateFromStorage: () => void;
  /** Snapshots the current session into the one saved slot, overwriting it. */
  saveToStorage: () => void;
  /**
   * Discards the current session in memory and starts a blank one — the
   * only intentional way to abandon a project. Deliberately never touches
   * the saved localStorage slot itself: `saveToStorage` is the only thing
   * that ever writes there, so a project you never explicitly saved is
   * never silently lost by starting a new one, and one you already saved
   * stays exactly as you last saved it until you choose to overwrite it.
   */
  startNewProject: () => void;
  /** A free-text message about the current project — answered, or turned into an actual model change, by the AI itself (see chatWithProject.ts). */
  sendChatMessage: (message: string) => Promise<void>;
}

async function refreshFindings(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  options: { recordVersion?: boolean } = {},
): Promise<void> {
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
      body: JSON.stringify({ model: get().model }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to identify failures.");
    const findings = body.findings as AiFinding[];
    set((state) => ({
      findings,
      findingsStatus: "done",
      findingsStale: false,
      // `model` — the value fetched against, captured before the
      // `await` above — not `state.model`: nothing else changes it while
      // a build/rework's own refreshFindings call is in flight.
      versions: options.recordVersion
        ? [...state.versions, { id: crypto.randomUUID(), model, findings, createdAt: Date.now() }]
        : state.versions,
    }));
  } catch (err) {
    set({
      findingsStatus: "done",
      findingsError: err instanceof Error ? err.message : "Failed to identify failures.",
    });
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  model: EMPTY_MODEL,
  history: [],
  findings: [],
  findingsStatus: "idle",
  findingsError: null,
  openComponentId: null,
  selectedFindingId: null,
  selectedFixId: null,
  canResimulate: false,
  findingsStale: false,
  lastSavedAt: null,
  chatMessages: [],
  chatStatus: "idle",
  chatError: null,
  appliedFixes: [],
  pendingFixes: [],
  viewingComponent: null,
  versions: [],
  previewVersionId: null,

  setModel: (model) => {
    set({
      model,
      history: [],
      findings: [],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
      chatMessages: [],
      chatStatus: "idle",
      chatError: null,
      appliedFixes: [],
      pendingFixes: [],
      viewingComponent: null,
      versions: [],
      previewVersionId: null,
    });
    void refreshFindings(set, get, { recordVersion: true });
  },

  setWorkloadTier: (dimension, tier) => {
    const { model, history } = get();
    const current = model.workload[dimension];
    if (!current) return;
    set({
      model: { ...model, workload: { ...model.workload, [dimension]: { ...current, tier } } },
      history: [...history, model],
      canResimulate: true,
      findingsStale: true,
    });
  },

  applyFix: (newModel, appliedFix) => {
    const { model, history, appliedFixes } = get();
    set({
      model: newModel,
      history: [...history, model],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: true,
      // Not refreshed here — same as setWorkloadTier, this only marks
      // findings stale and waits for an explicit Re-simulate click, rather
      // than spending an identifyFailures call on every single fix/chat
      // change. See this file's own top comment.
      findingsStale: true,
      appliedFixes: appliedFix ? [...appliedFixes, appliedFix] : appliedFixes,
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
    });
  },

  unqueueFix: (componentId, findingTitle) => {
    const { pendingFixes } = get();
    set({
      pendingFixes: pendingFixes.filter(
        (p) => !(p.componentId === componentId && p.findingTitle === findingTitle),
      ),
      // Deliberately doesn't touch canResimulate — something else (a
      // tier change, another still-queued fix) may still warrant it, and
      // this app has no cheap way to tell "was it ONLY this" apart from
      // that. Worst case, Re-simulate stays enabled with nothing new to
      // do, which costs nothing until actually clicked.
    });
  },

  commitRework: (newModel) => {
    const { model, history, appliedFixes, pendingFixes } = get();
    const nowApplied: AppliedFixRecord[] = pendingFixes.map((p) => ({
      componentId: p.componentId,
      findingTitle: p.findingTitle,
      fixLabel: p.fixLabel,
      appliedAt: Date.now(),
    }));
    set({
      model: newModel,
      history: [...history, model],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
      // Every queued fix just got sent to the AI as explicit context (see
      // ResimulateButton.tsx) — whether or not the result perfectly
      // reflects it, it's no longer "pending"; if identifyFailures (run
      // right below) still finds the underlying issue, it'll simply
      // reappear as a fresh, current, re-queueable finding.
      pendingFixes: [],
      appliedFixes: [...appliedFixes, ...nowApplied],
    });
    void refreshFindings(set, get, { recordVersion: true });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const previous = history[history.length - 1]!;
    set({ model: previous, history: history.slice(0, -1) });
    void refreshFindings(set, get);
  },

  setOpenComponentId: (id) => set({ openComponentId: id, selectedFindingId: null, selectedFixId: null }),

  selectFinding: (id) => set({ selectedFindingId: id, selectedFixId: null }),

  selectFix: (id) => set({ selectedFixId: id }),

  openComponentDetail: (component) => set({ viewingComponent: component }),

  closeComponentDetail: () => set({ viewingComponent: null }),

  previewVersion: (id) => set({ previewVersionId: id }),

  restoreVersion: (id) => {
    const { model, history, versions } = get();
    const version = versions.find((v) => v.id === id);
    if (!version) return;
    set({
      model: version.model,
      history: [...history, model],
      findings: version.findings,
      findingsStatus: "done",
      findingsError: null,
      findingsStale: false,
      canResimulate: false,
      // Any queued fixes were chosen against the state being replaced —
      // they no longer refer to anything meaningful once it's gone.
      pendingFixes: [],
      previewVersionId: null,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
    });
  },

  hydrateFromStorage: () => {
    const session = loadSession();
    if (!session) return;
    set({
      model: session.model,
      history: session.history,
      findings: session.findings,
      // A save can never be mid-flight ("loading") by the time it's read
      // back — there's no request left to resume, so treat it as settled.
      findingsStatus: session.findingsStatus === "loading" ? "done" : session.findingsStatus,
      findingsError: session.findingsError,
      canResimulate: session.canResimulate,
      // `?? false` covers a session saved before this field existed.
      findingsStale: session.findingsStale ?? false,
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
    });
  },

  saveToStorage: () => {
    const {
      model,
      history,
      findings,
      findingsStatus,
      findingsError,
      canResimulate,
      findingsStale,
      chatMessages,
      appliedFixes,
      pendingFixes,
      versions,
    } = get();
    const saved = saveSession({
      model,
      history,
      findings,
      findingsStatus: findingsStatus === "loading" ? "done" : findingsStatus,
      findingsError,
      canResimulate,
      findingsStale,
      chatMessages,
      appliedFixes,
      pendingFixes,
      versions,
    });
    if (saved) set({ lastSavedAt: saved.savedAt });
  },

  startNewProject: () => {
    set({
      model: EMPTY_MODEL,
      history: [],
      findings: [],
      findingsStatus: "idle",
      findingsError: null,
      findingsStale: false,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
      chatMessages: [],
      chatStatus: "idle",
      chatError: null,
      appliedFixes: [],
      pendingFixes: [],
      viewingComponent: null,
      versions: [],
      previewVersionId: null,
    });
  },

  sendChatMessage: async (message) => {
    const { model, chatMessages } = get();
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, message, history }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Chat failed.");
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          { role: "assistant", text: body.reply as string, changed: Boolean(body.model) },
        ],
        chatStatus: "idle",
      }));
      // A change request — commit it exactly like applying a fix: push
      // undo history, clear stale selections, mark findings stale, and
      // enable Re-simulate (which is what will actually refresh findings,
      // if and when the user clicks it — no identifyFailures call here).
      if (body.model) get().applyFix(body.model as SystemModel);
    } catch (err) {
      set({ chatStatus: "idle", chatError: err instanceof Error ? err.message : "Chat failed." });
    }
  },
}));
