import type { ChatMessage, PendingChatChange } from "../../sessionStorage";
import { MAX_PENDING_CHANGES } from "../../limits";
import { newActionId, reportOutcome } from "../../usageClient";
import { sequence } from "../sequencing";
import { usageProjectIdOf } from "../session";
import type { StoreGet, StoreSet } from "../types";

/**
 * How many prior chat messages (~4 exchanges) get sent as context on the
 * next one. Bounded, not the full transcript: unbounded history means
 * the request keeps growing every message for the life of a session —
 * exactly the kind of cost creep this project has been actively cutting
 * elsewhere. Enough for a real follow-up ("why is that?") to make sense;
 * older context quietly drops off rather than being resent forever.
 */
const CHAT_HISTORY_WINDOW = 8;

export interface ChatState {
  /**
   * The ongoing conversation for the CURRENT project — separate from
   * `findings`, never wiped by a rework/fix/reset (those change the
   * architecture; the conversation about it continues alongside that).
   * Only `setModel`/`startNewProject` reset it, since those mean "this is
   * a different project now."
   */
  chatMessages: ChatMessage[];
  chatStatus: "idle" | "loading";
  chatError: string | null;
}

export interface ChatActions {
  /** A free-text message about the current project — answered, or queued as a change for the next Re-simulate, by the AI itself (see chatWithProject.ts). */
  sendChatMessage: (message: string) => Promise<void>;
}

export type ChatSlice = ChatState & ChatActions;

export function createChatActions(set: StoreSet, get: StoreGet): ChatActions {
  return {
    sendChatMessage: async (message) => {
      const { model, chatMessages, findings, pendingFixes, pendingChanges } = get();
      const epoch = sequence.epoch;
      const actionId = newActionId();
      // Bounded window, not the full transcript — see CHAT_HISTORY_WINDOW:
      // unbounded history is exactly the kind of cost creep this project has
      // been actively cutting elsewhere. Nothing a queued change needs is
      // lost to the window: each carries its own self-contained instruction
      // (see `pendingChanges`), and the whole queue is sent below on every
      // message.
      const history = chatMessages
        .slice(-CHAT_HISTORY_WINDOW)
        .map((m) => ({ role: m.role, content: m.text }));
      set({
        chatMessages: [...chatMessages, { role: "user", text: message }],
        chatStatus: "loading",
        chatError: null,
      });
      try {
        // `findings`/`pendingFixes`/`pendingChanges` are what the dashboard
        // and queue are showing right now — passed so chat's answers stay
        // grounded in exactly that (and a follow-up change builds on what's
        // already queued), not a version it re-derives from the raw model
        // alone. Same "send the full store shape, the API route narrows it"
        // pattern ResimulateButton.tsx uses.
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            message,
            history,
            findings,
            pendingFixes,
            pendingChanges,
            actionId,
            projectId: usageProjectIdOf(get()),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Chat failed.");
        // The project was switched or reset while this was in flight — the
        // reply belongs to a session that's no longer open. (The switch
        // itself already reset chat status.) It was still billed.
        if (epoch !== sequence.epoch) {
          reportOutcome(actionId, "project-switched");
          return;
        }

        const reply = body.reply as string;
        const instruction = body.instruction as string | undefined;
        // A change request: queued, never applied — the model on screen does
        // not move until Re-simulate. Nothing about the live model can make
        // this stale (unlike the old apply-immediately path, which had to
        // withhold a change if a tier moved mid-flight), so there's no
        // race to guard beyond the epoch check above. Only the cap can
        // refuse it, and that's said in the reply rather than dropped silently.
        const wantsQueue = instruction !== undefined && !body.isQuestion;
        const queueFull = wantsQueue && get().pendingChanges.length >= MAX_PENDING_CHANGES;
        const change: PendingChatChange | null =
          wantsQueue && !queueFull
            ? {
                id: crypto.randomUUID(),
                request: message,
                instruction,
                ...(Array.isArray(body.kinds) ? { kinds: (body.kinds as unknown[]).filter((k): k is string => typeof k === "string") } : {}),
                queuedAt: Date.now(),
              }
            : null;
        set((state) => ({
          chatMessages: [
            ...state.chatMessages,
            {
              role: "assistant",
              text: queueFull
                ? `${reply} — Not queued: ${MAX_PENDING_CHANGES} changes are already waiting. Re-simulate to apply them first, then ask again.`
                : reply,
              ...(change ? { change: { id: change.id, status: "queued" as const } } : {}),
            },
          ],
          chatStatus: "idle",
          ...(change
            ? {
                pendingChanges: [...state.pendingChanges, change],
                // Re-simulate is what applies it; the findings themselves
                // aren't stale (the model hasn't changed), same as a queued fix.
                canResimulate: true,
              }
            : {}),
          // The conversation (and a queued change) should survive a reload.
          autosaveRevision: state.autosaveRevision + 1,
        }));
      } catch (err) {
        if (epoch !== sequence.epoch) return;
        set({ chatStatus: "idle", chatError: err instanceof Error ? err.message : "Chat failed." });
      }
    },
  };
}
