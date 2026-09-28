"use client";

import { useEffect, useState } from "react";

export interface TrialStatus {
  /** Held to the free quota (everyone except admins, while the trial is on). */
  limited: boolean;
  /** A guest: an anonymous account, not yet signed up. */
  guest: boolean;
}

/**
 * Who the free quota applies to, asked of the server (the admin allow-list is server-only). Shapes
 * the UI only - the quota itself is enforced on the server (lib/trial/server.ts).
 */
export function useTrialStatus(): TrialStatus {
  const [status, setStatus] = useState<TrialStatus>({ limited: false, guest: false });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/trial/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Partial<TrialStatus> | null) => {
        if (!cancelled && b) setStatus({ limited: b.limited === true, guest: b.guest === true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}
