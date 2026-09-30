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
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; shape?: string; width?: number; text?: string },
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
 *
 * `initialGuest` comes from the server (page.tsx ran `guestTrialOpen()` before sending HTML): the guest
 * option is present or absent in the FIRST markup the browser gets, so it never pops in after a client
 * fetch resolves. The client still re-checks once (below) in case the budget changed in the few seconds
 * since the server rendered, but only replaces state when the answer actually differs, so the common
 * case (nothing changed) never re-renders or shifts anything.
 */
export function LoginForm({ initialGuest }: { initialGuest: { available: boolean; captcha: boolean } }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  // Google's own docs don't publish a height for this - a plain button and the taller "Continue as
  // [name]" card it renders instead when the browser already has an active Google session are different
  // sizes, and guessing one fixed number caused exactly the reflow this is meant to prevent. Measured
  // instead of guessed: null until the ResizeObserver below reports Google's real rendered height, and the
  // button is only revealed once that's known, so the reveal itself is never a resize.
  const [googleHeight, setGoogleHeight] = useState<number | null>(null);
  const [guest, setGuest] = useState(initialGuest);
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
      .then((s: { available?: boolean; captcha?: boolean }) => {
        const next = { available: s.available === true, captcha: s.captcha === true };
        // Only replaces state (and re-renders) if the budget actually changed since the server checked it a
        // moment ago - the common case is "no change", and that must never cause a visible shift of its own.
        setGuest((prev) => (prev.available === next.available && prev.captcha === next.captcha ? prev : next));
      })
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
      // Without this, a browser already signed into a Google account gets an optimistic personalized
      // "Continue as X" button that Google's own async session check then reverts to the generic one a
      // couple of seconds later (confirmed live: frame-by-frame diffing a recording showed the swap
      // confined entirely to the button box, nothing else on the page moves - so this isn't the reflow
      // that was fixed separately, it's Google's own content changing after the fact). auto_select is
      // documented for suppressing automatic/expedited credential selection; whether it also suppresses
      // this specific button-level swap isn't documented, so treat this as a plausible mitigation, not a
      // confirmed fix - it needs checking against a real signed-in-to-Google browser to know for sure.
      auto_select: false,
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      shape: "rectangular",
      // Forces the generic label explicitly rather than letting Google choose one contextually - same
      // reasoning and same caveat as auto_select above.
      text: "signin_with",
      // As wide as the grouped panel allows (280 at most; Google accepts 200-400): a fixed 280 overflowed it on phones.
      width: Math.max(200, Math.min(280, googleButtonRef.current.clientWidth || 280)),
    });
    // Google inserts its own DOM into the ref synchronously here, but gives no callback with its size - the
    // ResizeObserver below is what actually reveals the button, once it can measure what got rendered.
  }

  useEffect(() => {
    const el = googleButtonRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.round(entry.contentRect.height);
      if (height > 0) setGoogleHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="grid min-h-screen lg:h-screen lg:grid-cols-[1.15fr_1fr] lg:overflow-hidden">
      <Script src="https://accounts.google.com/gsi/client" onLoad={onGoogleScriptLoad} />
      <LoginHero />
      {/* `lg:h-screen lg:overflow-y-auto`: this column is capped to one viewport and scrolls on its own,
          so it never inherits height from the hero panel next to it (see LoginHero.tsx's comment - that
          was what pushed the card down and cut off the Terms/Privacy line below the fold). `my-auto` on
          the inner wrapper, not `justify-center` on this flex column, is what centers the content: auto
          margins collapse to 0 once the content is taller than the viewport, so a very short screen gets
          a scrollbar and top-aligned content instead of clipping the bottom of the form. */}
      <div className="flex flex-col items-center px-6 py-10 lg:h-screen lg:overflow-y-auto">
        <div className="my-auto flex w-full max-w-sm flex-col items-center">
        {/* Small screens have no hero panel: the brand and the one-line pitch lead instead. */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
            <Logo className="h-8 w-auto" />
            <Wordmark className="text-2xl" />
          </div>
          <h1 className="text-sm text-slate-500 dark:text-slate-400">See where your system breaks before your users do.</h1>
        </div>

        <Card className="w-full">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Save your systems and pick up where you left off.</p>

          {/* Google and email are one group: both make a permanent account that keeps your projects. */}
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Your projects are saved</p>
          {/* Height is the MEASURED result (googleHeight), not a guess: Google renders its own DOM into this
              box asynchronously (a plain button, or a taller "Continue as X" card if this browser already
              has a Google session), and revealing it before knowing its real size is exactly what caused a
              visible resize here before. The button stays in the layout but invisible until the
              ResizeObserver above reports a height, so the wrapper is already the right size the moment it
              appears - a skeleton fills the 40px default slot until then. */}
          <div className="relative flex items-center justify-center" style={{ height: googleHeight ?? 40 }}>
            {googleHeight === null && (
              <div aria-hidden className="h-10 w-full max-w-70 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
            )}
            <div
              ref={googleButtonRef}
              className={`flex justify-center ${googleHeight === null ? "invisible absolute inset-x-0" : ""}`}
            />
          </div>

        <div className="my-3 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          or use email
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>

        {status === "sent" ? (
          <div role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
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
              className="rounded-lg border border-slate-200 px-3 py-2 text-base outline-none sm:text-sm focus:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500"
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
            <div className="mb-3 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
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
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">No account needed. One build, one Re-simulate and a few chat messages, not saved long-term.</p>
          </div>
        )}

        {shownError && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {shownError}
          </p>
        )}
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          By continuing you agree to the{" "}
          <a href="/terms" className="underline hover:text-slate-600 dark:hover:text-slate-300">Terms</a> and{" "}
          <a href="/privacy" className="underline hover:text-slate-600 dark:hover:text-slate-300">Privacy Policy</a>.
        </p>
        </div>
      </div>
    </main>
  );
}
