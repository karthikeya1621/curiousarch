import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { Wordmark } from "./Wordmark";
import { LEGAL_UPDATED, contactEmail } from "../lib/site";

/** Shared shell for the privacy policy and terms: readable column, brand header, contact line. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const email = contactEmail();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
      <Link href="/login" className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
        <Logo className="h-7 w-auto" />
        <Wordmark className="text-lg" />
      </Link>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="mt-1 text-xs text-slate-400">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-6 space-y-5 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
      <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700">
        Questions:{" "}
        {email ? (
          <a className="underline" href={`mailto:${email}`}>
            {email}
          </a>
        ) : (
          "use the contact address published on our website"
        )}
        . <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link>
      </p>
    </main>
  );
}
