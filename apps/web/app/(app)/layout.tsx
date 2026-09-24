import type { ReactNode } from "react";
import { Workspace } from "../../components/Workspace";

/**
 * Renders the whole workspace for `/` and `/project/<id>` from a layout, not
 * from either page, so it's one instance that survives navigating between
 * them (a page would remount on every URL change — see Workspace.tsx). The
 * pages below are intentionally empty; the URL is state the workspace reads
 * and writes, and their only job is to make the routes exist.
 *
 * `/login`, `/auth/*` and `/admin/*` sit outside this group and never load
 * the workspace.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Workspace />
      {children}
    </>
  );
}
