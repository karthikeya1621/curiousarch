import { create } from "zustand";
import { checkout } from "@archsim/engine";
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
 * happen to produce a same-id fix on the same component. Only
 * setModel/selectScenario/selectFix are exported as mutators — no raw
 * setters a component could call and forget the reset.
 */
interface AppState {
  model: SystemModel;
  selectedScenarioId: string | null;
  selectedFixId: string | null;
  setModel: (model: SystemModel) => void;
  selectScenario: (id: string | null) => void;
  selectFix: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  model: checkout, // a real default, not a placeholder — no "unset" state to guard against
  selectedScenarioId: null,
  selectedFixId: null,

  setModel: (model) =>
    set({ model, selectedScenarioId: null, selectedFixId: null }),

  selectScenario: (id) =>
    set({ selectedScenarioId: id, selectedFixId: null }),

  selectFix: (id) => set({ selectedFixId: id }),
}));
