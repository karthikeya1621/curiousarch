"use client";

import { useEffect } from "react";
import { useAppStore } from "../lib/store";
import { SystemDashboard } from "../components/SystemDashboard";
import { ControlPanel } from "../components/ControlPanel";
import { FailureSidebar } from "../components/FailureSidebar";
import { ProseInput } from "../components/ProseInput";
import { ChatWidget } from "../components/ChatWidget";
import { AutoSaveIndicator } from "../components/AutoSaveIndicator";
import { ProjectsCard } from "../components/ProjectsCard";
import { VersionHistory } from "../components/VersionHistory";
import { PreviewBanner } from "../components/PreviewBanner";
import { ComponentDetailModal } from "../components/ComponentDetailModal";
import { AccountMenu } from "../components/AccountMenu";
import { ActivityIcon } from "../components/icons";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const hydrateFromStorage = useAppStore((s) => s.hydrateFromStorage);
  const hydrated = useAppStore((s) => s.hydrated);
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
  useEffect(() => {
    void hydrateFromStorage();
  }, [hydrateFromStorage]);

  if (!hydrated) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-350 items-center justify-center px-6 py-5 lg:px-10">
        <p className="text-sm text-slate-400">Loading your project…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-350 px-6 py-5 lg:px-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
            <ActivityIcon className="h-4 w-4" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">Curious Arch</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <AutoSaveIndicator />
          <VersionHistory />
          <AccountMenu />
        </div>
      </header>

      {isBlank ? (
        <div className="mx-auto mt-10 flex max-w-xl flex-col gap-4">
          <ProjectsCard />
          <ProseInput />
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
