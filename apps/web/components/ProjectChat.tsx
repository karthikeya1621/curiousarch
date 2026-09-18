"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { Card } from "./Card";
import { SparklesIcon } from "./icons";

/**
 * The sidebar box for an EXISTING project — distinct from ProseInput,
 * which only ever builds a brand-new system (blank canvas / "New
 * Project"). This never resets or replaces the model on its own; the AI
 * decides per-message whether it's answering a question or making an
 * actual change (see chatWithProject.ts), and a change is committed the
 * same way applying a fix is (undo history, Re-simulate re-enabled,
 * findings refreshed). Reads the current model from the store itself
 * (via `sendChatMessage`), not a prop — there's nothing else here that
 * needs it.
 */
export function ProjectChat() {
  const chatMessages = useAppStore((s) => s.chatMessages);
  const chatStatus = useAppStore((s) => s.chatStatus);
  const chatError = useAppStore((s) => s.chatError);
  const sendChatMessage = useAppStore((s) => s.sendChatMessage);
  const [draft, setDraft] = useState("");

  function submit() {
    const message = draft.trim();
    if (!message || chatStatus === "loading") return;
    setDraft("");
    void sendChatMessage(message);
  }

  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <SparklesIcon className="h-4 w-4 text-slate-400" />
        Ask or change this system
      </div>
      <p className="text-xs text-slate-500">
        Ask a question about this architecture, or ask for a change — e.g. &quot;why is
        the cache short-TTL?&quot; or &quot;add a CDN in front of the gateway&quot;.
      </p>

      {chatMessages.length > 0 && (
        <div className="mt-2 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
          {chatMessages.map((m, i) => (
            <div
              key={i}
              className={
                "max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "self-end bg-slate-900 text-white"
                  : "self-start bg-slate-100 text-slate-700")
              }
            >
              {m.text}
            </div>
          ))}
          {chatStatus === "loading" && (
            <div className="self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400">
              Thinking…
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Ask a question or request a change…"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!draft.trim() || chatStatus === "loading"}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Send
        </button>
      </div>
      {chatError && <p className="mt-2 text-xs text-rose-600">{chatError}</p>}
    </Card>
  );
}
