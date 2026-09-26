"use client";

import { useAppStore } from "../lib/store";

/**
 * Shown after a Re-simulate that REMOVED components nobody asked it to remove
 * (nothing was queued). The model dropping something unprompted has happened on a
 * real project and went unnoticed for several versions; this makes it visible the
 * moment it happens, and points at the way back (the previous version).
 */
export function ReworkWarning() {
  const warning = useAppStore((s) => s.reworkWarning);
  const dismiss = useAppStore((s) => s.dismissReworkWarning);
  if (!warning) return null;
  const names = warning.removed.map((c) => c.label).join(", ");
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <span>
        This Re-simulate removed {warning.removed.length === 1 ? "a component" : `${warning.removed.length} components`} you didn&apos;t
        ask to remove: <strong>{names}</strong>. If that&apos;s wrong, open Version History and restore the previous version.
      </span>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-md border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
      >
        Dismiss
      </button>
    </div>
  );
}
