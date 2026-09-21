"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { ChevronDownIcon } from "./icons";

/**
 * A separate floating box under the Re-simulate button (see
 * FlowDiagram.tsx), not nested inside its own container — kept as its own
 * component so it can size itself naturally (a fixed `max-w-xs`, not
 * matched to the button's width; that was tried and looked wrong) and be
 * collapsed independently of the button.
 *
 * Each row only states a fact ("2 fixes queued"); the one shared call to
 * action ("Re-simulate to see these…") lives in the footer instead of
 * being repeated on every row. Rows are independent — a tier moved AND a
 * fix is queued AND a chat change was made can all be true at once (see
 * store.ts's own comment on `parametersChangedSinceResimulate` /
 * `chatChangeSinceResimulate` for why they aren't derived from one shared
 * flag), so each renders on its own condition, not as an either/or.
 *
 * The count beside the header stays visible when collapsed, so hiding the
 * list never hides the fact that something is still pending.
 */
export function ResimulateNotes() {
  const pendingFixes = useAppStore((s) => s.pendingFixes);
  const parametersChanged = useAppStore(
    (s) => s.parametersChangedSinceResimulate,
  );
  const chatChanged = useAppStore((s) => s.chatChangeSinceResimulate);
  const [expanded, setExpanded] = useState(true);

  const items: { key: string; text: string }[] = [];
  if (pendingFixes.length > 0) {
    items.push({
      key: "fixes",
      text: `${pendingFixes.length} fix${pendingFixes.length === 1 ? "" : "es"} queued`,
    });
  }
  if (parametersChanged)
    items.push({ key: "parameters", text: "Parameters changed" });
  if (chatChanged) items.push({ key: "chat", text: "Change made via chat" });
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
          <ul className="divide-y divide-amber-200 text-[11px] text-amber-700 dark:divide-amber-900 dark:text-amber-400">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-1.5 px-2 py-1.5"
              >
                <span
                  aria-hidden
                  className="h-1 w-1 shrink-0 rounded-full bg-amber-500"
                />
                {item.text}
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
