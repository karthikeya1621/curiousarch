import { create } from "zustand";
import type { AppliedFixRecord, PendingFix, ProjectSummary, Version } from "../sessionStorage";
import { EMPTY_MODEL, emptySession, usageProjectIdOf } from "./session";
import { createChatActions } from "./slices/chatSlice";
import { createModelActions } from "./slices/modelSlice";
import { createProjectActions } from "./slices/projectSlice";
import { createQueueActions } from "./slices/queueSlice";
import { createSelectionActions } from "./slices/selectionSlice";
import { createVersionsActions } from "./slices/versionsSlice";
import type { AppState } from "./types";

export type { AppliedFixRecord, PendingFix, ProjectSummary, Version };

/**
 * The single zustand store. Its state and actions live in six domain slices
 * (`slices/`), composed here; `types.ts` has the combined `AppState`. Kept as
 * `lib/store` (this index) so nothing that imports it had to change when the
 * old single file was split.
 *
 * Two rules the slices share, worth knowing before editing any of them:
 *  - An async action that writes back after an `await` must check
 *    `sequence` (sequencing.ts) first, or a slow response lands in whatever
 *    project happens to be open by then.
 *  - "What's pending" is DERIVED (pending.ts's `derivePending`), never
 *    latched by an action — see `baselineModel`'s comment in modelSlice.ts.
 */
export const useAppStore = create<AppState>((set, get) => ({
  ...emptySession(),
  model: EMPTY_MODEL,
  lastSavedAt: null,
  hydrated: false,
  autosaveRevision: 0,
  currentProjectId: null,
  draftProjectId: crypto.randomUUID(),
  projects: [],
  projectsStatus: "idle",
  ...createModelActions(set, get),
  ...createSelectionActions(set),
  ...createQueueActions(set, get),
  ...createChatActions(set, get),
  ...createVersionsActions(set, get),
  ...createProjectActions(set, get),
}));

/** The id AI usage is filed under for the project on screen — saved id if it has one, else the one it will be saved with. */
export function usageProjectId(): string {
  return usageProjectIdOf(useAppStore.getState());
}
