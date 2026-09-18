"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Shared shell for every modal in this app (`ConfirmDialog`,
 * `ComponentDetailModal`) — backdrop, centering, Esc-to-close,
 * click-outside-to-close. `position: fixed` needs no portal here:
 * nothing in this app gives an ancestor a transform/filter, which is the
 * only thing that would create a containing block and break fixed
 * positioning.
 */
export function Modal({
  open,
  onClose,
  children,
  widthClassName = "max-w-sm",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthClassName} rounded-xl border border-slate-200 bg-white p-5 shadow-lg`}
      >
        {children}
      </div>
    </div>
  );
}
