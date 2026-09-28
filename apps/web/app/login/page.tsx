"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Script from "next/script";
import { createClient } from "../../lib/supabase/client";
import { nextCookieString, safeNextPath } from "../../lib/nextPath";
import { Card } from "../../components/Card";
import { Logo } from "../../components/Logo";
import { LoginHero } from "../../components/LoginHero";
import { Wordmark } from "../../components/Wordmark";
import { MailIcon, AlertTriangleIcon, CheckCircleIcon } from "../../components/icons";

/**
 * Minimal ambient types for the one Google Identity Services entry point
 * this page uses — no `@types/google.accounts`-style package pulled in
 * for two methods.
 */
declare global {
  interface Window {
    hcaptcha?: { render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => void };
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; shape?: string; width?: number },
          ) => void;
        };
      };
    };
  }
}

/** The validated `?next=` this page was redirected here with (see proxy.ts), if any. */
function nextFromUrl(): string | null {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/**
 * Google's button renders directly into this page's own origin — unlike
 * the old `supabase.auth.signInWithOAuth` redirect flow (which sent the
 * browser through Supabase's own `*.supabase.co` domain to complete the
 * handshake, and showed that domain to the user on Google's consent
 * screen instead of ours), this talks to Google client-side and only
 * hands Supabase the resulting ID token to verify — so Google's consent
 * screen shows this site's real origin, not Supabase's.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  // Guest trial: offered only while the server says it is open (budget not spent). When it is not,
  // the option is not shown at all rather than shown disabled.
  const [guest, setGuest] = useState<{ available: boolean; captcha: boolean }>({ available: false, captcha: false });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);

  // /auth/callback sends a failed link here with ?error=link. Read from the URL without an effect (server render: false).
  const linkFailed = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("error") === "link",
    () => false,
  );
  const shownError =
    error ?? (linkFailed ? "That sign-in link has expired or was opened on a different device. Request a new one below." : null);

  useEffect(() => {
    fetch("/api/trial/status")
      .then((r) => r.json())
      .then((s: { available?: boolean; captcha?: boolean }) => setGuest({ available: s.available === true, captcha: s.captcha === true }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!guest.available || !guest.captcha || !captchaRef.current) return;
    const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
    if (!siteKey) return;
    const render = () => {
      if (window.hcaptcha && captchaRef.current && !captchaRef.current.hasChildNodes()) {
        window.hcaptcha.render(captchaRef.current, { sitekey: siteKey, callback: setCaptchaToken });
      }
    };
    if (window.hcaptcha) return render();
    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [guest]);

  async function startGuest() {
    if (guestBusy || (guest.captcha && !captchaToken)) return;
    setGuestBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
    if (error) {
      setError(error.message);
      setGuestBusy(false);
      return;
    }
    // Full page load so the previous session's in-memory project can't carry over.
    window.location.assign(nextFromUrl() ?? "/");
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    setError(null);
    // The magic link opens in a fresh navigation via /auth/callback, so
    // remember where they were headed in a cookie it can read (see nextPath.ts).
    const next = nextFromUrl();
    if (next) document.cookie = nextCookieString(next, window.location.protocol === "https:");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  async function handleGoogleCredential(response: { credential: string }) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: response.credential,
    });
    if (error) {
      setError(error.message);
      return;
    }
    // Full page load so the previous session's in-memory project can't carry over.
    window.location.assign(nextFromUrl() ?? "/");
  }

  function onGoogleScriptLoad() {
    if (!window.google || !googleButtonRef.current) return;
    window.google.accounts.id.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      shape: "rectangular",
      width: 280, // fits the grouped panel (card 344px inner minus the group's padding)
    });
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <Script src="https://accounts.google.com/gsi/client" onLoad={onGoogleScriptLoad} />
      <LoginHero />
      <div className="flex flex-col items-center justify-center px-6 py-10">
        {/* Small screens have no hero panel: the brand and the one-line pitch lead instead. */}
        <div className="mb-8 flex max-w-sm flex-col items-center gap-3 text-center lg:hidden">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
            <Logo className="h-8 w-auto" />
            <Wordmark className="text-2xl" />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">See where your system breaks before your users do.</p>
        </div>

        <Card className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Save your systems and pick up where you left off.</p>

          {/* Google and email are one group: both make a permanent account that keeps your projects. */}
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">Your projects are saved</p>
          <div ref={googleButtonRef} className="flex justify-center" />

        <div className="my-3 flex items-center gap-3 text-[11px] text-slate-400">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          or use email
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>

        {status === "sent" ? (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Check {email} for a sign-in link.</span>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="flex flex-col gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              autoComplete="email"
              name="email"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-slate-300"
            >
              <MailIcon className="h-3.5 w-3.5" />
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
          </div>

        {guest.available && (
          <div className="mt-5 text-center">
            <div className="mb-3 flex items-center gap-3 text-[11px] text-slate-400">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              or just look around
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            {guest.captcha && <div ref={captchaRef} className="mb-2 flex justify-center" />}
            <button
              type="button"
              onClick={() => void startGuest()}
              disabled={guestBusy || (guest.captcha && !captchaToken)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:enabled:hover:bg-slate-800"
            >
              {guestBusy ? "Starting…" : "Try it as a guest"}
            </button>
            <p className="mt-1.5 text-[11px] text-slate-400">No account needed. One build, one Re-simulate and a few chat messages, not saved long-term.</p>
          </div>
        )}

        {shownError && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {shownError}
          </p>
        )}
        </Card>
        <p className="mt-4 max-w-sm text-center text-xs text-slate-400">
          By continuing you agree to the{" "}
          <a href="/terms" className="underline hover:text-slate-600 dark:hover:text-slate-300">Terms</a> and{" "}
          <a href="/privacy" className="underline hover:text-slate-600 dark:hover:text-slate-300">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}
