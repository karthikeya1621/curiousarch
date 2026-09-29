"use client";

import { Modal } from "./Modal";

/**
 * Replaces window.confirm() for New Project / Save's overwrite prompt — a
 * native dialog can't be styled, uses generic OK/Cancel labels instead of
 * the app's own verbs, and looks jarring next to the rest of the rounded-
 * card aesthetic.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} role="alertdialog" labelledBy="confirm-dialog-title" describedBy="confirm-dialog-message">
      <div>
        <h2 id="confirm-dialog-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
