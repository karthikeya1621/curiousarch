"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAppStore } from "../lib/store";
import { decideRouteSync, parseProjectPath, type RouteSyncInput } from "../lib/projectRoute";
import { SystemDashboard } from "./SystemDashboard";
import { ControlPanel } from "./ControlPanel";
import { FailureSidebar } from "./FailureSidebar";
import { ProseInput } from "./ProseInput";
import { EmptyStateAside } from "./EmptyStateAside";
import { ChatWidget } from "./ChatWidget";
import { AutoSaveIndicator } from "./AutoSaveIndicator";
import { ProjectsCard } from "./ProjectsCard";
import { VersionHistory } from "./VersionHistory";
import { PreviewBanner } from "./PreviewBanner";
import { ReworkWarning } from "./ReworkWarning";
import { ComponentDetailModal } from "./ComponentDetailModal";
import { AccountMenu } from "./AccountMenu";
import { GuestBanner } from "./GuestBanner";
import { AdminUsageLink } from "./AdminUsageLink";
import { Card } from "./Card";
import { Logo } from "./Logo";
import { Wordmark } from "./Wordmark";

/**
 * The whole app: header, projects, canvas, chat. Rendered by the `(app)`
 * route group's LAYOUT (app/(app)/layout.tsx), not by a page, so it is ONE
 * instance shared by `/` and `/project/<id>` — going from one to the other
 * (autosave giving a new project its first id, switching projects) is a soft
 * navigation that never remounts this, and so never closes the chat popup or
 * resets an open panel mid-use. Were it a page, every URL change would
 * remount it.
 *
 * The URL follows the open project and the open project follows the URL; see
 * lib/projectRoute.ts for the (pure, tested) rule about which one leads.
 */
export function Workspace() {
  const model = useAppStore((s) => s.model);
  const hydrateFromStorage = useAppStore((s) => s.hydrateFromStorage);
  const openProject = useAppStore((s) => s.openProject);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const hydrated = useAppStore((s) => s.hydrated);
  const router = useRouter();
  const routeId = parseProjectPath(usePathname());
  // The id from a /project/<id> URL that couldn't be shown (deleted, not
  // this user's, not a real id). Cleared as soon as the URL changes.
  const [missingId, setMissingId] = useState<string | null>(null);
  const prevSync = useRef<RouteSyncInput["prev"]>(null);
  const openingId = useRef<string | null>(null);
  const versions = useAppStore((s) => s.versions);
  const previewVersionId = useAppStore((s) => s.previewVersionId);
  const isBlank = model.components.length === 0;
  const previewVersion = versions.find((v) => v.id === previewVersionId) ?? null;

  // Client-only, post-mount: the store's initial state (blank canvas) must
  // match on the server-rendered and first client render to avoid a
  // hydration mismatch, so restoring a saved session has to happen after
  // that first render, not during it. Now a DB fetch (not instant like the
  // old localStorage read), so `hydrated` gates rendering the real UI to
  // avoid flashing the blank canvas while it's in flight.
  //
  // A `/project/<id>` URL names the project to open, so it wins over the
  // last-viewed pointer; on any other path the pointer is used. Read once, at
  // mount — later URL changes are handled by the sync effect below.
  const initialRouteId = useRef(routeId);
  useEffect(() => {
    void hydrateFromStorage(initialRouteId.current ?? undefined);
  }, [hydrateFromStorage]);

  // Keeps the URL and the open project agreeing. What to do is decided by
  // `decideRouteSync` (pure); this only carries it out.
  useEffect(() => {
    const action = decideRouteSync({ hydrated, routeId, currentId: currentProjectId, prev: prevSync.current });
    if (!hydrated) return;
    prevSync.current = { routeId, currentId: currentProjectId };

    if (action.type === "navigate") {
      if (action.mode === "push") router.push(action.to);
      else router.replace(action.to);
    } else if (action.type === "open") {
      if (openingId.current === action.id) return; // already on its way
      openingId.current = action.id;
      setMissingId(null);
      const id = action.id;
      void openProject(id).then((result) => {
        if (openingId.current !== id) return; // the URL moved on while it loaded
        openingId.current = null;
        // Only a genuine miss says "not found". `superseded` means a newer
        // open (another click) took over and will settle the URL itself —
        // flashing "not found" for it would be a lie about a project that is
        // fine.
        if (result === "not-found") setMissingId(id);
      });
    } else if (action.type === "missing") {
      setMissingId(action.id);
    } else if (routeId === null || routeId === currentProjectId) {
      setMissingId(null);
    }
  }, [hydrated, routeId, currentProjectId, openProject, router]);

  if (!hydrated) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-350 items-center justify-center px-6 py-5 lg:px-10">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading your project…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-350 px-6 py-5 pb-24 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-auto shrink-0 text-slate-900 dark:text-slate-100" />
          <h1 className="text-lg tracking-tight text-slate-900 dark:text-slate-100">
            <Wordmark />
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <AutoSaveIndicator />
          <VersionHistory />
          <AdminUsageLink />
          <AccountMenu />
        </div>
      </header>
      <GuestBanner />

      {missingId !== null ? (
        <div className="mx-auto mt-10 max-w-xl">
          <Card>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Project not found</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This link doesn&apos;t match a project in your account — it may have been deleted, or it may belong
              to someone else.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              Go to your projects
            </Link>
          </Card>
        </div>
      ) : isBlank ? (
        // First-run screen: the describe box leads (left), the picture of what comes next sits beside it,
        // and the projects list only appears once there is something in it.
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-stretch">
          <div className="flex flex-col gap-4">
            <ProseInput />
            <ProjectsCard hideWhenEmpty />
          </div>
          <EmptyStateAside />
        </div>
      ) : previewVersion ? (
        <div className="mt-4 flex flex-col gap-4">
          <PreviewBanner />
          <SystemDashboard model={previewVersion.model} findingsOverride={previewVersion.findings} />
        </div>
      ) : (
        <>
          {/* Two columns: a 300px Controls column (with the Projects card
              above it) and the canvas taking the rest of the width. Below
              `lg` it stacks, Dashboard first. */}
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="order-2 flex flex-col gap-3 lg:order-1">
              <ProjectsCard />
              <ControlPanel model={model} />
            </div>

            <div className="order-1 flex flex-col gap-5 lg:order-2">
              <ReworkWarning />
              <SystemDashboard model={model} showResimulate />
              <FailureSidebar model={model} />
            </div>
          </div>

          <ChatWidget />
        </>
      )}

      <ComponentDetailModal />
    </main>
  );
}
