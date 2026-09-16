import { create } from "zustand";
import { checkout, setParameterValue } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";

/**
 * Only ids are stored, never the Scenario/Fix/ScenarioDelta/FixResult
 * objects themselves — their `apply` fields are functions, which would
 * silently break serialization if devtools/persist middleware is ever
 * added. Everything else is derived on read (see lib/hooks.ts).
 *
 * The invariant this store exists to enforce: a Fix id is only unique
 * within one (model, scenarioId) call — listFixes derives ids from
 * whatever findings the scenario actually produces, so a stale
 * selectedFixId left over after changing selectedScenarioId isn't just
 * stale, it can resolve to a *different, wrong* fix if two scenarios
 * happen to produce a same-id fix on the same component. setModel clears
 * both selections and the undo history (a full model swap, e.g. from
 * prose inference, isn't something a user would expect to "undo" back
 * through). updateParameter/setWorkloadRps deliberately do NOT clear
 * selections: correcting a value never changes a component's id or kind,
 * so every selected id stays valid, and clearing them would hide the
 * effect of the edit the user just made. Only setModel/updateParameter/
 * setWorkloadRps/undo/selectScenario/selectFix are exported as mutators —
 * no raw setters a component could call and forget the invariant.
 *
 * openComponentId tracks which flow-diagram node's failure list is showing
 * in the sidebar (FailureSidebar) — it's UI state, not model state, but it
 * has to be shared between the diagram (where the indicator badges live)
 * and the sidebar (where the list actually renders), so it lives here like
 * the other cross-component selection state.
 */
interface AppState {
  model: SystemModel;
  history: SystemModel[];
  selectedScenarioId: string | null;
  selectedFixId: string | null;
  openComponentId: string | null;
  setModel: (model: SystemModel) => void;
  updateParameter: (componentId: string, field: string, value: number) => void;
  setWorkloadRps: (rps: number) => void;
  undo: () => void;
  selectScenario: (id: string | null) => void;
  selectFix: (id: string | null) => void;
  setOpenComponentId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  model: checkout, // a real default, not a placeholder — no "unset" state to guard against
  history: [],
  selectedScenarioId: null,
  selectedFixId: null,
  openComponentId: null,

  setModel: (model) =>
    set({
      model,
      history: [],
      selectedScenarioId: null,
      selectedFixId: null,
      openComponentId: null,
    }),

  updateParameter: (componentId, field, value) => {
    const { model, history } = get();
    set({
      model: setParameterValue(model, componentId, field, value),
      history: [...history, model],
    });
  },

  setWorkloadRps: (rps) => {
    const { model, history } = get();
    set({
      model: { ...model, workload: { ...model.workload, rps } },
      history: [...history, model],
    });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    set({ model: history[history.length - 1], history: history.slice(0, -1) });
  },

  selectScenario: (id) =>
    set({ selectedScenarioId: id, selectedFixId: null }),

  selectFix: (id) => set({ selectedFixId: id }),

  setOpenComponentId: (id) => set({ openComponentId: id }),
}));
