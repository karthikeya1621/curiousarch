"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { ChevronDownIcon, XIcon } from "./icons";

/**
 * A separate floating box under the Re-simulate button (see
 * FlowDiagram.tsx), not nested inside its own container — kept as its own
 * component so it can size itself naturally (a fixed `max-w-xs`, not
 * matched to the button's width; that was tried and looked wrong) and be
 * collapsed independently of the button.
 *
 * Queued items are listed ONE PER ROW (each fix, each chat change), not as
 * a count, because this is the one place that shows everything waiting for
 * Re-simulate — so it's also where any of it can be taken back out (the ✕).
 * A fix could previously only be un-queued by finding its finding, opening
 * it and toggling the fix; a chat change only from its message in the chat.
 * Removing either here is the same store action those use. Parameter and
 * legacy architecture changes are facts, not queue entries: parameters are
 * undone with Reset in the Controls card, and the legacy row has no undo.
 *
 * Rows are independent — a tier moved AND a fix is queued AND a chat
 * change was made can all be true at once (see store.ts's own comment on
 * `parametersChangedSinceResimulate` / `chatChangeSinceResimulate` for why
 * they aren't derived from one shared flag), so each renders on its own
 * condition, not as an either/or. The one shared call to action ("These
 * changes are applied when you Re-simulate") lives in the footer instead of
 * being repeated on every row.
 *
 * The count beside the header stays visible when collapsed, so hiding the
 * list never hides the fact that something is still pending.
 */
interface NoteItem {
  key: string;
  text: string;
  /** Muted lead-in naming the kind of queued item, for the rows that can be removed. */
  kind?: string;
  /** Present only on a queued item the user can take back out. */
  onRemove?: () => void;
}

export function ResimulateNotes() {
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const pendingChanges = useAppStore((s) => s.pendingChanges);
  const parametersChanged = useAppStore(
    (s) => s.parametersChangedSinceResimulate,
  );
  const chatChanged = useAppStore((s) => s.chatChangeSinceResimulate);
  const unqueueFix = useAppStore((s) => s.unqueueFix);
  const unqueueChatChange = useAppStore((s) => s.unqueueChatChange);
  const [expanded, setExpanded] = useState(true);

  const items: NoteItem[] = [
    ...pendingFixes.map((f) => ({
      key: `fix:${f.componentId}:${f.findingTitle}`,
      kind: "Fix",
      text: `${f.fixLabel} (${f.componentId})`,
      onRemove: () => unqueueFix(f.componentId, f.findingTitle),
    })),
    ...pendingChanges.map((c) => ({
      key: `chat:${c.id}`,
      kind: "Chat",
      text: c.request,
      onRemove: () => unqueueChatChange(c.id),
    })),
  ];
  if (parametersChanged)
    items.push({ key: "parameters", text: "Parameters changed" });
  if (chatChanged) items.push({ key: "chat-legacy", text: "Change made via chat" });
  if (items.length === 0) return null;

  return (
    <div className="max-w-xs overflow-hidden rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/80">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-1.5 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300"
      >
        <span className="flex items-center gap-1.5">
          Updates since last Re-simulate
          <span className="rounded-full bg-amber-200/70 px-1.5 text-[10px] leading-4 dark:bg-amber-900/70">
            {items.length}
          </span>
        </span>
        {/* No explicit color class — inherits the button's own
            text-amber-800/dark:text-amber-300 via currentColor (see
            icons.tsx's shared `base` props), so it always matches the
            header text exactly rather than needing its own amber shade
            kept in sync by hand. */}
        <ChevronDownIcon
          className={
            "h-3 w-3 shrink-0 transition-transform " +
            (expanded ? "rotate-180" : "")
          }
        />
      </button>
      {expanded && (
        <div className="border-t border-amber-200 dark:border-amber-900">
          <ul className="max-h-48 divide-y divide-amber-200 overflow-y-auto text-[11px] text-amber-700 dark:divide-amber-900 dark:text-amber-400">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-1.5 px-2 py-1.5"
              >
                <span
                  aria-hidden
                  className="h-1 w-1 shrink-0 rounded-full bg-amber-500"
                />
                {/* `title` carries the full text — the row itself truncates
                    so a long request never stretches the box. */}
                <span className="min-w-0 flex-1 truncate" title={item.text}>
                  {item.kind && (
                    <span className="mr-1 font-semibold text-amber-800 dark:text-amber-300">
                      {item.kind}
                    </span>
                  )}
                  {item.text}
                </span>
                {item.onRemove && (
                  <button
                    type="button"
                    onClick={item.onRemove}
                    aria-label={`Remove queued ${item.kind?.toLowerCase()}: ${item.text}`}
                    title="Remove from the queue"
                    className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-200/70 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-900/60 dark:hover:text-amber-200"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-amber-200 bg-amber-100/60 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
            <span className="font-semibold">Note:</span> These changes are
            applied when you Re-simulate.
          </p>
        </div>
      )}
    </div>
  );
}
