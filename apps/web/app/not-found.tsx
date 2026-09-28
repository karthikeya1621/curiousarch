import Link from "next/link";
import { Logo } from "../components/Logo";
import { Wordmark } from "../components/Wordmark";

/** Unknown URLs (and the 404 the admin page returns to everyone else) get the app's own page, not Next's default. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
        <Logo className="h-7 w-auto" />
        <Wordmark className="text-lg" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">That page doesn&apos;t exist, or it isn&apos;t yours to see.</p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        Go to your projects
      </Link>
    </main>
  );
}
