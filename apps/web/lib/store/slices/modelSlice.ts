import type { AiFinding, SystemModel } from "@archsim/engine";
import type { AppliedFixRecord } from "../../sessionStorage";
import { derivePending } from "../pending";
import { refreshFindings } from "../findings";
import { sequence } from "../sequencing";
import { emptySession } from "../session";
import type { StoreGet, StoreSet } from "../types";

/** The system on screen, the AI findings about it, and everything that says whether those two still agree. */
export interface ModelState {
  model: SystemModel;
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  canResimulate: boolean;
  /**
   * True specifically since a workload-tier control moved, reset once a
   * Re-simulate (or restoring a version) addresses it — narrower than
   * `canResimulate`, which also flips true for a queued fix or chat change
   * (or an architecture difference), and can't by itself tell those apart.
   * Exists so the Updates panel can show a "parameters changed" note
   * specifically for a tier move, independent of (and alongside) its
   * separate "N fixes queued" note — the two are not mutually exclusive,
   * both can be true at once, and conflating them under `canResimulate`
   * alone made the parameter-change note disappear whenever a fix was
   * also queued.
   */
  parametersChangedSinceResimulate: boolean;
  /**
   * The model the current `findings` describe: set by a fresh build, a
   * Re-simulate, restoring a version, loading a project, and again whenever a
   * findings refresh lands (that refresh IS "findings now match this model").
   *
   * Everything about "what's pending" is DERIVED from comparing the live
   * `model` against this (see `derivePending`), rather than latched by each
   * action as it happens. Latched flags could only ever go true — moving a
   * tier slider back to where it started, or pressing Reset, left the "Updates"
   * panel, the enabled Re-simulate button and the pending caption all stuck
   * on for a change that no longer existed, and with billing per simulation
   * that would let someone pay for a no-op. `null` only for a project saved
   * before this existed and still carrying pending changes; those keep the
   * old latched behavior until their next Re-simulate sets a baseline.
   */
  baselineModel: SystemModel | null;
  /**
   * The architecture (components/edges) differs from `baselineModel` — a
   * change already IN the model that Re-simulate hasn't reviewed. Nothing
   * produces one any more (chat and fixes both queue instead of editing the
   * model), so this is only ever true for a project saved back when chat
   * edited the model directly; the notes panel still shows it for those.
   */
  chatChangeSinceResimulate: boolean;
  /**
   * True once the model has changed (a raised tier, an architecture edit)
   * without `findings` having been recomputed for it yet — the dashboard
   * mutes the findings list and shows a caption while this is true, since
   * otherwise a stale and a fresh findings list are visually identical.
   * Derived from the baseline (`derivePending`); only a successful
   * `refreshFindings` (from `setModel`/`commitRework`) makes `findings`
   * match `model` again.
   */
  findingsStale: boolean;
}

export interface ModelActions {
  /** `actionId` groups this build's AI calls (see lib/usageClient.ts); supplied when the caller already spent calls on it (the infer request), minted otherwise. */
  setModel: (model: SystemModel, actionId?: string) => void;
  setWorkloadTier: (dimension: "users" | "requests", tier: number) => void;
  /** `actionId` is the Re-simulate's (see setModel), so the version it records is joined to what the rework cost. */
  commitRework: (newModel: SystemModel, actionId?: string) => void;
  /**
   * Puts the workload controls back to the values the last simulation used
   * (`baselineModel.workload`). Purely local — no API call, no version, no
   * findings refresh: it only discards unsimulated control changes, and what's
   * "pending" is re-derived from the comparison. Leaves any queued fixes and
   * chat changes alone; those have their own controls.
   */
  revertParameters: () => void;
}

export type ModelSlice = ModelState & ModelActions;

export function createModelActions(set: StoreSet, get: StoreGet): ModelActions {
  return {
    setModel: (model, actionId) => {
      sequence.epoch++;
      set({
        ...emptySession(),
        model,
        baselineModel: model,
        autosaveRevision: get().autosaveRevision + 1,
      });
      void refreshFindings(set, get, actionId);
    },

    setWorkloadTier: (dimension, tier) => {
      const { model } = get();
      const current = model.workload[dimension];
      if (!current) return;
      // Deliberately does NOT bump autosaveRevision — a parameter change is
      // something to review, not to persist (or redraw the canvas for — see
      // FlowDiagram.tsx's own comment on why it depends on
      // model.components/model.edges rather than model itself) on its own;
      // only an explicit Re-simulate commits it. See `autosaveRevision`'s own
      // doc comment.
      const next = { ...model, workload: { ...model.workload, [dimension]: { ...current, tier } } };
      const { baselineModel, pendingFixes, pendingChanges } = get();
      const derived = derivePending(next, baselineModel, pendingFixes, pendingChanges);
      set({
        model: next,
        // Derived, so moving a tier back to where it started clears it. With
        // no baseline (a legacy project), fall back to latching it on.
        ...(derived ?? {
          canResimulate: true,
          parametersChangedSinceResimulate: true,
          findingsStale: true,
        }),
        // Only when the controls land back on the baseline: a save that
        // happened while they were changed (a queued fix bumps the counter
        // too) would otherwise leave the changed values persisted, and
        // reloading would show a parameter change that was already reverted.
        ...(derived && !derived.parametersChangedSinceResimulate
          ? { autosaveRevision: get().autosaveRevision + 1 }
          : {}),
      });
    },

    commitRework: (newModel, actionId) => {
      const { appliedFixes, pendingFixes, chatMessages } = get();
      const nowApplied: AppliedFixRecord[] = pendingFixes.map((p) => ({
        componentId: p.componentId,
        findingTitle: p.findingTitle,
        fixLabel: p.fixLabel,
        appliedAt: Date.now(),
      }));
      set({
        model: newModel,
        openComponentId: null,
        selectedFindingId: null,
        selectedFixId: null,
        canResimulate: false,
        parametersChangedSinceResimulate: false,
        chatChangeSinceResimulate: false,
        baselineModel: newModel,
        // Every queued fix just got sent to the AI as explicit context (see
        // ResimulateButton.tsx) — whether or not the result perfectly
        // reflects it, it's no longer "pending"; if identifyFailures (run
        // right below) still finds the underlying issue, it'll simply
        // reappear as a fresh, current, re-queueable finding.
        pendingFixes: [],
        // Same for queued chat changes — they were sent alongside the fixes,
        // so their chat messages now read "applied".
        pendingChanges: [],
        chatMessages: chatMessages.map((m) =>
          m.change?.status === "queued" ? { ...m, change: { ...m.change, status: "applied" as const } } : m,
        ),
        appliedFixes: [...appliedFixes, ...nowApplied],
        autosaveRevision: get().autosaveRevision + 1,
      });
      void refreshFindings(set, get, actionId);
    },

    revertParameters: () => {
      const { model, baselineModel, pendingFixes, pendingChanges } = get();
      if (!baselineModel) return;
      const next = { ...model, workload: baselineModel.workload };
      set({
        model: next,
        // Re-derived rather than blanket-cleared: a queued fix or chat change
        // made alongside the parameters is still pending afterwards.
        ...derivePending(next, baselineModel, pendingFixes, pendingChanges)!,
        // Persist the reverted state (see setWorkloadTier for why).
        autosaveRevision: get().autosaveRevision + 1,
      });
    },
  };
}
