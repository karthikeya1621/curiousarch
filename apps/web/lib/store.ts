import { create } from "zustand";
import type { AiFinding, SystemModel } from "@archsim/engine";

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
  setModel: (model: SystemModel) => void;
  setWorkloadTier: (dimension: "users" | "requests", tier: number) => void;
  applyFix: (newModel: SystemModel) => void;
  commitRework: (newModel: SystemModel) => void;
  undo: () => void;
  setOpenComponentId: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  selectFix: (id: string | null) => void;
}

async function refreshFindings(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const { model } = get();
  if (model.components.length === 0) {
    set({ findings: [], findingsStatus: "idle", findingsError: null });
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
    set({ findings: body.findings as AiFinding[], findingsStatus: "done" });
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

  setModel: (model) => {
    set({
      model,
      history: [],
      findings: [],
      openComponentId: null,
      selectedFindingId: null,
      selectedFixId: null,
      canResimulate: false,
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
}));
