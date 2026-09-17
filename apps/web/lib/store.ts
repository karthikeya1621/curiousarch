import { create } from "zustand";
import { checkout } from "@archsim/engine";
import type { ScaleTier, SystemModel } from "@archsim/engine";

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
 * through). setWorkloadScale deliberately does NOT clear selections:
 * changing the scale never changes a component's id or kind, so every
 * selected id stays valid, and clearing them would hide the effect of the
 * change the user just made. Only setModel/setWorkloadScale/applyFix/undo/
 * selectScenario/selectFix/setOpenComponentId are exported as mutators —
 * no raw setters a component could call and forget the invariant.
 *
 * openComponentId tracks which flow-diagram node's failure list is showing
 * in the sidebar (FailureSidebar) — it's UI state, not model state, but it
 * has to be shared between the diagram (where the indicator badges live)
 * and the sidebar (where the list actually renders), so it lives here like
 * the other cross-component selection state.
 *
 * applyFix commits a fix's transform to the REAL model — not the
 * hypothetical failure+fix combination FixResultPanel previews. A scenario
 * models "what if this broke"; a fix is a real change ("add a circuit
 * breaker") a user could actually make. Applying one means "make that real change,"
 * not "also pretend the hypothetical failure happened forever" — so the
 * caller passes `fix.apply(model)` (the fix against the current real
 * model), never `fix.apply(scenario.apply(model))`. Like a full model
 * swap, it clears the transient selections (the old scenario/fix/open
 * node no longer describe anything meaningful once the model has moved),
 * but like a scale change, it pushes undo history rather than clearing
 * it — this is one step in an ongoing evolution, not a fresh start.
 *
 * There is deliberately no `updateTrait` here anymore: component traits
 * are read-only in the UI (ControlPanel.tsx) — the architecture only
 * evolves via a scenario/fix or a fresh prose description, never by
 * hand-toggling a switch. `setWorkloadScale` survives because traffic
 * scale is the one real non-functional requirement, not a component trait.
 */
interface AppState {
  model: SystemModel;
  history: SystemModel[];
  selectedScenarioId: string | null;
  selectedFixId: string | null;
  openComponentId: string | null;
  setModel: (model: SystemModel) => void;
  setWorkloadScale: (scale: ScaleTier) => void;
  applyFix: (newModel: SystemModel) => void;
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

  setWorkloadScale: (scale) => {
    const { model, history } = get();
    set({
      model: { ...model, workload: { scale: { ...model.workload.scale, value: scale, provenance: "stated" } } },
      history: [...history, model],
    });
  },

  applyFix: (newModel) => {
    const { model, history } = get();
    set({
      model: newModel,
      history: [...history, model],
      selectedScenarioId: null,
      selectedFixId: null,
      openComponentId: null,
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
