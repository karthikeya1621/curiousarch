"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared shell for every modal in this app (`ConfirmDialog`,
 * `ComponentDetailModal`) — backdrop, centering, Esc-to-close,
 * click-outside-to-close. `position: fixed` needs no portal here:
 * nothing in this app gives an ancestor a transform/filter, which is the
 * only thing that would create a containing block and break fixed
 * positioning.
 *
 * It is also a real dialog for keyboard and screen-reader users: the panel has
 * a dialog role and a name, focus moves into it when it opens, Tab stays inside
 * it, and focus goes back to whatever opened it when it closes. (Before this,
 * focus stayed on the button behind the backdrop and Tab walked the page
 * underneath.)
 */
export function Modal({
  open,
  onClose,
  children,
  widthClassName = "max-w-sm",
  role = "dialog",
  labelledBy,
  describedBy,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  role?: "dialog" | "alertdialog";
  /** id of the element that titles the dialog. Give this or `ariaLabel`. */
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Kept in a ref so a parent re-render that passes a new `onClose` does not re-run the focus effect below.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Into the dialog: the first control if there is one, otherwise the panel itself.
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthClassName} rounded-xl border border-slate-200 bg-white p-5 shadow-lg outline-none dark:border-slate-700 dark:bg-slate-800`}
      >
        {children}
      </div>
    </div>
  );
}
