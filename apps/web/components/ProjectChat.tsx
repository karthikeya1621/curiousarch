"use client";

import { useRef, useState } from "react";
import type { Component } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { Badge } from "./Badge";
import { Card } from "./Card";
import { SparklesIcon, WrenchIcon, XIcon } from "./icons";

/**
 * Matches a `/comp` token only when it's the thing currently being typed —
 * anchored to the end of the string, and either at the very start or right
 * after a whitespace, so "/comp" appearing earlier in an already-finished
 * sentence never re-triggers the picker. Group 1 is the leading boundary
 * (empty string or the whitespace char itself, needed to compute where
 * "/comp" itself starts); group 2 is whatever's been typed since as a
 * filter query.
 */
const SLASH_COMP_PATTERN = /(^|\s)\/comp(\S*)$/i;
const MAX_SUGGESTIONS = 8;

const CHANGE_STATUS_STYLE = {
  queued: { label: "Queued", tone: "text-amber-600 dark:text-amber-400" },
  applied: { label: "Applied", tone: "text-emerald-600 dark:text-emerald-400" },
  removed: { label: "Removed", tone: "text-slate-400" },
} as const;

/**
 * Where a chat-requested change stands: queued until the next Re-simulate
 * applies it (removable until then), applied afterwards, or removed. Only
 * "queued" offers Remove — an applied change is in the model now, and undoing
 * it is a new request, not a queue edit.
 */
function ChangeStatus({
  status,
  onRemove,
}: {
  status: keyof typeof CHANGE_STATUS_STYLE;
  onRemove?: () => void;
}) {
  const { label, tone } = CHANGE_STATUS_STYLE[status];
  return (
    <div className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      <WrenchIcon className="h-3 w-3" />
      {label}
      {status === "queued" && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded px-1 font-medium normal-case tracking-normal text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * The chat panel for an EXISTING project — distinct from ProseInput,
 * which only ever builds a brand-new system (blank canvas / "New
 * Project"). This never resets or replaces the model on its own; the AI
 * decides per-message whether it's answering a question or being asked for
 * a change (see chatWithProject.ts), and a change is QUEUED the same way
 * choosing a fix is: it takes effect on the next Re-simulate, not now, and
 * can be removed until then. Reads the current model from the store itself
 * (via `sendChatMessage`), not a prop — there's nothing else here that
 * needs it.
 *
 * Only ever rendered inside ChatWidget.tsx's floating popup now (it used
 * to be a persistent third grid column) — `onClose` is what that popup's
 * own toggle button collapses back into a FAB.
 */
export function ProjectChat({ onClose }: { onClose: () => void }) {
  const chatMessages = useAppStore((s) => s.chatMessages);
  const chatStatus = useAppStore((s) => s.chatStatus);
  const chatError = useAppStore((s) => s.chatError);
  const sendChatMessage = useAppStore((s) => s.sendChatMessage);
  const components = useAppStore((s) => s.model.components);
  const unqueueChatChange = useAppStore((s) => s.unqueueChatChange);
  const [draft, setDraft] = useState("");
  // Typing more after "/comp" re-narrows the list; Escape dismisses it
  // for the rest of this token without touching the typed text. Both
  // reset on the next keystroke, same as a real combobox.
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const slashMatch = draft.match(SLASH_COMP_PATTERN);
  const query = slashMatch?.[2]?.toLowerCase() ?? "";
  const suggestions =
    slashMatch && !dismissed
      ? components
          .filter((c) => c.label.toLowerCase().includes(query) || c.id.toLowerCase().includes(query))
          .slice(0, MAX_SUGGESTIONS)
      : [];
  const suggestionsOpen = suggestions.length > 0;

  function insertComponent(component: Component) {
    if (!slashMatch) return;
    // slashMatch.index is where group 1 (the leading boundary) starts,
    // not where "/comp" itself does — offset past it, so a leading space
    // before "/comp" is kept rather than eaten.
    const slashStart = slashMatch.index! + slashMatch[1].length;
    const next = `${draft.slice(0, slashStart)}${component.label} (${component.id}) `;
    setDraft(next);
    setDismissed(false);
    setActiveIndex(0);
    // The input's value updates on this render; the caret only follows on
    // the NEXT one, so this has to wait a frame rather than run inline.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  function submit() {
    const message = draft.trim();
    if (!message || chatStatus === "loading") return;
    setDraft("");
    void sendChatMessage(message);
  }

  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <SparklesIcon className="h-4 w-4 text-slate-400" />
          Ask or change this system
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Ask a question about this architecture, or ask for a change — e.g. &quot;why is
        the cache short-TTL?&quot; or &quot;add a CDN in front of the gateway&quot;.
        Changes are queued and applied when you Re-simulate.
      </p>

      {chatMessages.length > 0 && (
        <div className="mt-2 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
          {chatMessages.map((m, i) => (
            <div
              key={i}
              className={
                "max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "self-end bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "self-start bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300")
              }
            >
              {m.role === "assistant" && (m.change || m.changed) && (
                <ChangeStatus
                  // `changed` is the old chat's flag, from when a change was
                  // applied to the model immediately.
                  status={m.change?.status ?? "applied"}
                  onRemove={m.change ? () => unqueueChatChange(m.change!.id) : undefined}
                />
              )}
              <span className={m.change?.status === "removed" ? "text-slate-400 line-through" : ""}>{m.text}</span>
            </div>
          ))}
          {chatStatus === "loading" && (
            <div className="self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400 dark:bg-slate-700">
              Thinking…
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          {suggestionsOpen && (
            <div
              role="listbox"
              aria-label="Matching components"
              className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            >
              {suggestions.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  // Fires before the input's blur, and preventDefault here
                  // stops that blur from happening at all — without this,
                  // the input loses focus first and the click can land on
                  // the wrong (re-rendered) suggestion, or feel like it
                  // didn't register.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertComponent(c)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm " +
                    (i === activeIndex ? "bg-slate-100 dark:bg-slate-700" : "")
                  }
                >
                  <span className="truncate text-slate-900 dark:text-slate-100">{c.label}</span>
                  <Badge tone="neutral">{c.kind}</Badge>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDismissed(false);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (suggestionsOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  // Defensive, not expected in practice: `activeIndex` is
                  // clamped against `suggestions.length` on every arrow
                  // key already, but the model (and so `components`,
                  // and so `suggestions`) could in principle change out
                  // from under an open dropdown from an outside source
                  // (another tab on the same project) between renders.
                  const selected = suggestions[activeIndex];
                  if (selected) insertComponent(selected);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissed(true);
                  return;
                }
              }
              if (e.key === "Enter") submit();
            }}
            placeholder="Ask about this system… (try /comp)"
            aria-label="Ask a question or request a change"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:bg-slate-800"
          />
        </div>
        <button
          onClick={submit}
          disabled={!draft.trim() || chatStatus === "loading"}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-slate-300 dark:disabled:bg-slate-600"
        >
          Send
        </button>
      </div>
      {chatError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{chatError}</p>}
    </Card>
  );
}
