import type { ModelSlice } from "./slices/modelSlice";
import type { SelectionSlice } from "./slices/selectionSlice";
import type { QueueSlice } from "./slices/queueSlice";
import type { ChatSlice } from "./slices/chatSlice";
import type { VersionsSlice } from "./slices/versionsSlice";
import type { ProjectSlice } from "./slices/projectSlice";

/**
 * The whole store is the union of six domain slices, each owning its own
 * state and actions (see slices/). They share ONE zustand store — slices
 * read and write each other's fields freely through `get`/`set`, because the
 * actions genuinely span domains (a Re-simulate commit touches the model, the
 * queues AND the chat transcript) — so the split is for navigability, not
 * isolation. Type-only imports both ways, so no runtime cycle.
 */
export interface AppState
  extends ModelSlice,
    SelectionSlice,
    QueueSlice,
    ChatSlice,
    VersionsSlice,
    ProjectSlice {}

export type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
export type StoreGet = () => AppState;
