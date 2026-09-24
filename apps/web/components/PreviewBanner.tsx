"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Shown only while browsing a past version (`previewVersionId` set) —
 * see page.tsx's preview/normal split. Restore asks first ONLY when there's
 * unsimulated work that would be lost (`canResimulate`: a moved control, a
 * chat change, a queued fix): the live model is replaced and not kept
 * anywhere (see `restoreVersion` in lib/store/slices/versionsSlice.ts) — this used to be safe without
 * a prompt only because the undo stack made it recoverable. With nothing pending, the
 * live model is already the last simulated one, i.e. already a version, so
 * there's nothing to lose and no reason to interrupt.
 */
export function PreviewBanner() {
  const versions = useAppStore((s) => s.versions);
  const previewVersionId = useAppStore((s) => s.previewVersionId);
  const previewVersion = useAppStore((s) => s.previewVersion);
  const restoreVersion = useAppStore((s) => s.restoreVersion);
  const hasUnsimulatedChanges = useAppStore((s) => s.canResimulate);
  const [confirming, setConfirming] = useState(false);

  const index = versions.findIndex((v) => v.id === previewVersionId);
  if (index === -1) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <span>
        Previewing <strong>Version {index + 1}</strong> — read-only
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => (hasUnsimulatedChanges ? setConfirming(true) : restoreVersion(previewVersionId!))}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Restore this version
        </button>
        <button
          onClick={() => previewVersion(null)}
          className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          Back to current
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Restore Version ${index + 1}?`}
        message="You have changes that haven't been simulated yet (parameters, a chat change, or queued fixes). Restoring this version discards them."
        confirmLabel="Restore"
        onConfirm={() => {
          setConfirming(false);
          restoreVersion(previewVersionId!);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
