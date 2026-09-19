"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { ThemeToggle } from "./ThemeToggle";
import { LogOutIcon } from "./icons";

/**
 * Replaces the old always-visible "Sign out" button — account actions
 * shouldn't sit at the same visual weight as content actions (Save,
 * Re-simulate, Projects). A circular avatar (not a rectangular button)
 * plus the extra left margin in page.tsx's header is what visually
 * separates "account" from "content" here, no divider line needed.
 *
 * An anchored dropdown, not `Modal.tsx` — this is a menu, not a dialog,
 * so it doesn't need a full-screen backdrop; closes on an outside click
 * the same way Modal closes on Escape. Also hosts ThemeToggle — a
 * display preference belongs with account settings, not its own header
 * control.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      // Google OAuth sets one of these on `user_metadata`; a magic-link
      // user has neither, which is fine — the initial-letter circle below
      // is the fallback either way.
      const meta = data.user?.user_metadata as { avatar_url?: string; picture?: string } | undefined;
      setAvatarUrl(meta?.avatar_url ?? meta?.picture ?? null);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = email ? email[0]!.toUpperCase() : "?";
  const showAvatar = avatarUrl && !avatarFailed;

  return (
    <div ref={wrapperRef} className="relative ml-2 shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
      >
        {showAvatar ? (
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {email && (
            <p className="truncate border-b border-slate-100 px-2.5 py-1.5 text-xs text-slate-400 dark:border-slate-700">
              {email}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <span className="text-xs text-slate-400">Theme</span>
            <ThemeToggle />
          </div>
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-1.5 rounded-md border-t border-slate-100 px-2.5 py-1.5 pt-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
