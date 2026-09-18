import { create } from "zustand";
import type { AiFinding, SystemModel } from "@archsim/engine";
import { loadSession, saveSession, type ChatMessage } from "./sessionStorage";

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
 * Findings are AI-generated now (`identifyFailures`), not computed — see
 * packages/engine/README.md and CONTEXT.md for the explicit product
 * decision behind this. They live here, not in a hook, because the
 * diagram (badge counts) and the sidebar (the actual list) both need the
 * same fetched result, and fetching is async — unlike the old
 * `useScenarios`/`useFixes`, which were synchronous `useMemo`s over a
 * deterministic function call.
 *
 * `refreshFindings` is NOT called from every model change — only from
 * `setModel`/`applyFix`/`commitRework`, the three actions where the user
 * just took an action whose direct result they'd want reviewed.
 * `setWorkloadTier` deliberately does NOT trigger it: moving the tier
 * slider is a passive setting change, not a request for the AI's
 * opinion — that's what the (now-enabled) Re-simulate button is for. This
 * is also why `findings` can go visibly stale relative to the model after
 * a tier change: that's the intended signal to click Re-simulate, not a
 * bug to paper over with an automatic call.
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
   * True once the model has changed (a raised tier) without `findings`
   * having been recomputed for it yet — the dashboard mutes the findings
   * list and shows a caption while this is true, since otherwise a stale
   * and a fresh findings list are visually identical. Only `setWorkloadTier`
   * sets it; every successful `refreshFindings` clears it, since that's the
   * only thing that makes `findings` actually match `model` again.
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
  setModel: (model: SystemModel) => void;
  setWorkloadTier: (dimension: "users" | "requests", tier: number) => void;
  applyFix: (newModel: SystemModel) => void;
  commitRework: (newModel: SystemModel) => void;
  undo: () => void;
  setOpenComponentId: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  selectFix: (id: string | null) => void;
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
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
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
    set({ findings: body.findings as AiFinding[], findingsStatus: "done", findingsStale: false });
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
    });
    void refreshFindings(set, get);
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

  applyFix: (newModel) => {
    const { model, history } = get();
    set({
      model: newModel,
      history: [...history, model],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: true,
    });
    void refreshFindings(set, get);
  },

  commitRework: (newModel) => {
    const { model, history } = get();
    set({
      model: newModel,
      history: [...history, model],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
    });
    void refreshFindings(set, get);
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
      // `?? []` covers a session saved before chat existed at all.
      chatMessages: session.chatMessages ?? [],
      chatStatus: "idle",
      chatError: null,
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
    });
  },

  saveToStorage: () => {
    const { model, history, findings, findingsStatus, findingsError, canResimulate, findingsStale, chatMessages } =
      get();
    const saved = saveSession({
      model,
      history,
      findings,
      findingsStatus: findingsStatus === "loading" ? "done" : findingsStatus,
      findingsError,
      canResimulate,
      findingsStale,
      chatMessages,
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
    });
  },

  sendChatMessage: async (message) => {
    const { model, chatMessages } = get();
    set({
      chatMessages: [...chatMessages, { role: "user", text: message }],
      chatStatus: "loading",
      chatError: null,
    });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, message }),
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
      // undo history, clear stale selections, enable Re-simulate, refresh
      // findings. The chat's own reply already told the user what changed.
      if (body.model) get().applyFix(body.model as SystemModel);
    } catch (err) {
      set({ chatStatus: "idle", chatError: err instanceof Error ? err.message : "Chat failed." });
    }
  },
}));
