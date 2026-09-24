"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChartIcon } from "./icons";

/**
 * A header link to /admin/usage, drawn only for an admin. Asks the server
 * once after mount (`/api/admin/status`) rather than deciding itself — the
 * admin allow-list is server-only — and renders nothing until (and unless)
 * the answer is yes, so a regular user never sees a flash of it or any hint
 * it exists. Purely a convenience: the page itself re-checks and 404s for
 * anyone else.
 */
export function AdminUsageLink() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/status")
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((body: { isAdmin?: boolean }) => {
        if (!cancelled) setIsAdmin(body.isAdmin === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAdmin) return null;

  return (
    <Link
      href="/admin/usage"
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      <BarChartIcon className="h-4 w-4" />
      Usage
    </Link>
  );
}
