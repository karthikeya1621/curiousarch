import type { Version } from "../../sessionStorage";
import { sequence } from "../sequencing";
import type { StoreGet, StoreSet } from "../types";

export interface VersionsState {
  /**
   * A checkpoint recorded on the initial build and every completed
   * Re-simulate (never on a fix or tier change). Only ever grows: browsing or
   * restoring an old version never removes anything from this list,
   * which is exactly why "read-only preview + explicit restore" is safe.
   */
  versions: Version[];
  /** Which version (if any) is being browsed read-only. `null` = viewing the live model. */
  previewVersionId: string | null;
}

export interface VersionsActions {
  previewVersion: (id: string | null) => void;
  /** Makes a past version live again. Never touches `versions` itself — so the current, unsimulated state isn't recoverable afterwards unless it was itself a version (PreviewBanner.tsx confirms first when there's unsimulated state to lose). */
  restoreVersion: (id: string) => void;
}

export type VersionsSlice = VersionsState & VersionsActions;

export function createVersionsActions(set: StoreSet, get: StoreGet): VersionsActions {
  return {
    previewVersion: (id) => set({ previewVersionId: id }),

    restoreVersion: (id) => {
      const { versions, chatMessages } = get();
      const version = versions.find((v) => v.id === id);
      if (!version) return;
      // Any findings request still in flight was for the state being
      // replaced — it must not overwrite the restored version's own findings.
      sequence.findings++;
      set({
        model: version.model,
        findings: version.findings,
        findingsStatus: "done",
        findingsError: null,
        findingsStale: false,
        canResimulate: false,
        parametersChangedSinceResimulate: false,
        chatChangeSinceResimulate: false,
        baselineModel: version.model,
        // Any queued fixes were chosen against the state being replaced —
        // they no longer refer to anything meaningful once it's gone.
        pendingFixes: [],
        // Same reasoning for queued chat changes — discarded, and their chat
        // messages say so rather than still claiming to be queued.
        pendingChanges: [],
        chatMessages: chatMessages.map((m) =>
          m.change?.status === "queued" ? { ...m, change: { ...m.change, status: "removed" as const } } : m,
        ),
        previewVersionId: null,
        openComponentId: null,
        selectedFindingId: null,
        selectedFixId: null,
        autosaveRevision: get().autosaveRevision + 1,
      });
    },
  };
}
