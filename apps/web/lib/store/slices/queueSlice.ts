import type { AppliedFixRecord, PendingChatChange, PendingFix } from "../../sessionStorage";
import { derivePending } from "../pending";
import type { StoreGet, StoreSet } from "../types";

/**
 * Everything waiting for the next Re-simulate: fixes the user picked from a
 * finding, and changes they asked for in chat. Both are QUEUED, never applied
 * on the spot — Re-simulate is the one deliberate (and billed) step that
 * rebuilds the architecture and sends every queued item to the AI together.
 */
export interface QueueState {
  /**
   * A log of fixes actually applied, not derived from the model — kept
   * even if a later change reverts one (same relationship a git log has to
   * `git revert`), so a component's modal can show its history honestly. Only
   * the formal finding->fix flow (`FindingPanel`) records an entry; a
   * chat-requested change can't be reliably attributed to one component
   * (and isn't in the model until Re-simulate), so it doesn't.
   */
  appliedFixes: AppliedFixRecord[];
  /**
   * Fixes chosen but not yet implemented — "Apply this fix" doesn't call the
   * AI (that used to cost a live call on every single click); it queues the
   * choice here instead, and Re-simulate is what actually sends it to the AI
   * (as explicit context, alongside its own holistic review) and implements
   * it. Only one queued entry per finding (matched by componentId +
   * findingTitle, same key isFindingFixed.ts already uses for
   * `appliedFixes`): picking a different fix for the same finding replaces
   * the earlier choice rather than sending the AI two conflicting
   * instructions for it. Cleared (moved into `appliedFixes`) by a successful
   * `commitRework` — never by anything else, so queuing several fixes and
   * resimulating once is the normal, cheaper way to use this.
   */
  pendingFixes: PendingFix[];
  /**
   * Changes the user asked for in chat, queued the same way as
   * `pendingFixes`: chat doesn't edit the model itself (that used to cost a
   * full model rewrite per message, and a second rework at Re-simulate). It
   * records the request here, and Re-simulate — the one deliberate step —
   * sends every entry to the AI as an explicit instruction. Each holds the
   * user's exact words AND a self-contained restatement (see
   * chatWithProject.ts), so no context is lost by waiting; chat itself is
   * shown this queue on every message so follow-ups build on it. Cleared by
   * `commitRework` (their chat messages flip to "applied") and by
   * `restoreVersion` (they flip to "removed"); capped at MAX_PENDING_CHANGES.
   */
  pendingChanges: PendingChatChange[];
}

export interface QueueActions {
  /** Queues a fix for the next Re-simulate — no AI call, no model change yet. Replaces any existing queued fix for the same finding. */
  queueFix: (pendingFix: PendingFix) => void;
  /** Removes a queued fix before Re-simulate runs. */
  unqueueFix: (componentId: string, findingTitle: string) => void;
  /** Takes a queued chat change back out before Re-simulate runs; its chat message shows it as removed. */
  unqueueChatChange: (id: string) => void;
}

export type QueueSlice = QueueState & QueueActions;

export function createQueueActions(set: StoreSet, get: StoreGet): QueueActions {
  return {
    queueFix: (pendingFix) => {
      const { pendingFixes } = get();
      const withoutExisting = pendingFixes.filter(
        (p) => !(p.componentId === pendingFix.componentId && p.findingTitle === pendingFix.findingTitle),
      );
      set({
        pendingFixes: [...withoutExisting, pendingFix],
        canResimulate: true,
        autosaveRevision: get().autosaveRevision + 1,
      });
    },

    unqueueFix: (componentId, findingTitle) => {
      const { model, pendingFixes, pendingChanges, baselineModel } = get();
      const remaining = pendingFixes.filter(
        (p) => !(p.componentId === componentId && p.findingTitle === findingTitle),
      );
      set({
        pendingFixes: remaining,
        autosaveRevision: get().autosaveRevision + 1,
        // Re-simulate stays available only if something ELSE still warrants
        // it (a tier change, a chat change, another queued fix) — this used
        // to be left alone because there was no way to tell, which kept an
        // enabled (and soon billable) button with nothing left to do. With
        // no baseline (a legacy project) it's still left alone.
        ...(baselineModel
          ? { canResimulate: derivePending(model, baselineModel, remaining, pendingChanges)!.canResimulate }
          : {}),
      });
    },

    unqueueChatChange: (id) => {
      const { model, pendingFixes, pendingChanges, baselineModel, chatMessages } = get();
      if (!pendingChanges.some((c) => c.id === id)) return;
      const remaining = pendingChanges.filter((c) => c.id !== id);
      set({
        pendingChanges: remaining,
        chatMessages: chatMessages.map((m) =>
          m.change?.id === id ? { ...m, change: { ...m.change, status: "removed" as const } } : m,
        ),
        autosaveRevision: get().autosaveRevision + 1,
        // Same rule as unqueueFix: Re-simulate stays available only if
        // something else still warrants it.
        ...(baselineModel
          ? { canResimulate: derivePending(model, baselineModel, pendingFixes, remaining)!.canResimulate }
          : {}),
      });
    },
  };
}
