"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "../components/Logo";
import { Wordmark } from "../components/Wordmark";

/**
 * What a user sees when something throws while rendering (the whole workspace is one client tree, so a bad
 * saved project or a render bug would otherwise show Next's bare default page). The project is saved
 * automatically, so "try again" is safe. `retry` is this Next version's recovery prop (see error.md).
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
        <Logo className="h-7 w-auto" />
        <Wordmark className="text-lg" />
      </div>
      <div role="alert">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          This page hit an unexpected problem. Your work is saved automatically, so trying again is safe.
        </p>
        {error.digest && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Reference: {error.digest}</p>}
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => retry()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Go to your projects
        </Link>
      </div>
    </main>
  );
}
