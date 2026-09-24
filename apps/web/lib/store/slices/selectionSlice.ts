import type { Component } from "@archsim/engine";
import type { StoreSet } from "../types";

/** Which finding/fix/component the UI is pointing at — pure view state, never persisted. */
export interface SelectionState {
  openComponentId: string | null;
  selectedFindingId: string | null;
  selectedFixId: string | null;
  /**
   * The component object behind the currently-open detail modal — an
   * object, not just an id, so it works correctly whether the diagram on
   * screen is the live model or a previewed past version (see
   * `previewVersionId`): whichever was actually clicked is what's shown.
   */
  viewingComponent: Component | null;
}

export interface SelectionActions {
  setOpenComponentId: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  selectFix: (id: string | null) => void;
  openComponentDetail: (component: Component) => void;
  closeComponentDetail: () => void;
}

export type SelectionSlice = SelectionState & SelectionActions;

export function createSelectionActions(set: StoreSet): SelectionActions {
  return {
    setOpenComponentId: (id) => set({ openComponentId: id, selectedFindingId: null, selectedFixId: null }),
    selectFinding: (id) => set({ selectedFindingId: id, selectedFixId: null }),
    selectFix: (id) => set({ selectedFixId: id }),
    openComponentDetail: (component) => set({ viewingComponent: component }),
    closeComponentDetail: () => set({ viewingComponent: null }),
  };
}
