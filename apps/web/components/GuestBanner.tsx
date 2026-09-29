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
  // The email box stays behind a button until asked for (or the trial runs out), so the resting banner is one slim line.
  const [showForm, setShowForm] = useState(false);
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

  // The live region itself is mounted from the first render and never re-created (a region inserted together with its
  // text is often not announced); only the visual banner inside it is remounted to replay the flash.
  return (
    <div role="status" aria-live="polite">
      {limited && (
    <div
      ref={bannerRef}
      key={flash}
      className={`${flash > 0 ? "trial-flash " : ""}mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${tone}`}
    >
      <span>
        {!guest
          ? limitHit
            ? "You've used the free plan. Your diagram stays as it is - credits for more are coming."
            : `Free plan: ${TRIAL_LIMITS.build} build, ${TRIAL_LIMITS.rework} Re-simulate and ${TRIAL_LIMITS.chat} chat messages on one project. Credits for more are coming.`
          : limitHit
          ? "You've used the free trial. Your diagram stays as it is - add your email to keep it and continue."
          : `Free trial · ${TRIAL_LIMITS.build} build, ${TRIAL_LIMITS.rework} Re-simulate, ${TRIAL_LIMITS.chat} chat messages`}
      </span>
      {!guest ? null : status === "sent" ? (
        <span className="text-xs">Check {email} for a confirmation link - it keeps this project.</span>
      ) : !showForm && !limitHit ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Save my work
        </button>
      ) : (
        <form onSubmit={upgrade} className="flex items-center gap-2">
          <input
            type="email"
            autoFocus={showForm}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-base text-slate-900 outline-none sm:text-xs focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
      {error && <span role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
      )}
    </div>
  );
}
