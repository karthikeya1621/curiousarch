"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { createClient } from "../../lib/supabase/client";
import { Card } from "../../components/Card";
import { ActivityIcon, MailIcon, AlertTriangleIcon, CheckCircleIcon } from "../../components/icons";

/**
 * Minimal ambient types for the one Google Identity Services entry point
 * this page uses — no `@types/google.accounts`-style package pulled in
 * for two methods.
 */
declare global {
  interface Window {
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
  const router = useRouter();

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    setError(null);
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
    router.push("/");
    router.refresh();
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
      width: 320,
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <Script src="https://accounts.google.com/gsi/client" onLoad={onGoogleScriptLoad} />
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
            <ActivityIcon className="h-5 w-5" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">archsim</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Sign in to build and save your systems.</p>
        </div>

        <div ref={googleButtonRef} className="mt-6 flex justify-center" />

        <div className="my-4 flex items-center gap-3 text-[11px] text-slate-400">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          or
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

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}
