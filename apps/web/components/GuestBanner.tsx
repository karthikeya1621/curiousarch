"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useTrialStatus } from "../lib/useTrialStatus";
import { TRIAL_LIMIT_EVENT } from "../lib/trialClient";
import { TRIAL_LIMITS } from "../lib/trial/limits";

/**
 * Shown only to a guest (a Supabase anonymous user). Asking for an email UPGRADES that same
 * account (`updateUser`), so the projects and versions made during the trial are kept - it is not
 * a fresh sign-up. Turns into the "trial used up" prompt when the server refuses an action.
 */
export function GuestBanner() {
  const { limited, guest } = useTrialStatus();
  const [limitHit, setLimitHit] = useState(false);
  // Bumped on every refused action so the highlight replays even when the banner is already amber.
  const [flash, setFlash] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onLimit = () => {
      setLimitHit(true);
      setFlash((n) => n + 1);
      // Re-simulate sits far from the top of the page: bring the message into view.
      bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    window.addEventListener(TRIAL_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(TRIAL_LIMIT_EVENT, onLimit);
  }, []);

  if (!limited) return null;

  async function upgrade(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    setError(null);
    const { error } = await createClient().auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/auth/callback` });
    if (error) {
      setError(error.message);
      setStatus("idle");
    } else {
      setStatus("sent");
    }
  }

  const tone = limitHit
    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300";

  return (
    <div
      ref={bannerRef}
      key={flash}
      role="status"
      className={`${flash > 0 ? "trial-flash " : ""}mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${tone}`}
    >
      <span>
        {!guest
          ? limitHit
            ? "You've used the free plan. Your diagram stays as it is - credits for more are coming."
            : `Free plan: ${TRIAL_LIMITS.build} build, ${TRIAL_LIMITS.rework} Re-simulate and ${TRIAL_LIMITS.chat} chat messages on one project. Credits for more are coming.`
          : limitHit
          ? "You've used the free trial. Your diagram stays as it is - add your email to keep it and continue."
          : `Free trial: ${TRIAL_LIMITS.build} build, ${TRIAL_LIMITS.rework} Re-simulate and ${TRIAL_LIMITS.chat} chat messages. Add your email to keep your work.`}
      </span>
      {!guest ? null : status === "sent" ? (
        <span className="text-xs">Check {email} for a confirmation link - it keeps this project.</span>
      ) : (
        <form onSubmit={upgrade} className="flex items-center gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
          >
            {status === "sending" ? "Sending…" : "Save my work"}
          </button>
        </form>
      )}
      {error && <span className="w-full text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
