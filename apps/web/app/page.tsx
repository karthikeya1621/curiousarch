"use client";

import { useEffect } from "react";
import { useAppStore } from "../lib/store";
import { SystemDashboard } from "../components/SystemDashboard";
import { ControlPanel } from "../components/ControlPanel";
import { FailureSidebar } from "../components/FailureSidebar";
import { ProseInput } from "../components/ProseInput";
import { ProjectChat } from "../components/ProjectChat";
import { ResimulateButton } from "../components/ResimulateButton";
import { SaveSessionButton } from "../components/SaveSessionButton";
import { NewProjectButton } from "../components/NewProjectButton";
import { VersionHistory } from "../components/VersionHistory";
import { PreviewBanner } from "../components/PreviewBanner";
import { ComponentDetailModal } from "../components/ComponentDetailModal";
import { ActivityIcon } from "../components/icons";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const hydrateFromStorage = useAppStore((s) => s.hydrateFromStorage);
  const versions = useAppStore((s) => s.versions);
  const previewVersionId = useAppStore((s) => s.previewVersionId);
  const isBlank = model.components.length === 0;
  const previewVersion = versions.find((v) => v.id === previewVersionId) ?? null;

  // Client-only, post-mount: the store's initial state (blank canvas) must
  // match on the server-rendered and first client render to avoid a
  // hydration mismatch, so restoring a saved session has to happen after
  // that first render, not during it.
  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  return (
    <main className="mx-auto w-full max-w-350 px-6 py-5 lg:px-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ActivityIcon className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">
              archsim
            </h1>
            <p className="max-w-xl text-xs text-slate-500">
              {isBlank
                ? "Describe a system to get started — an AI architect will sketch it, flag what could go wrong, and suggest fixes as you grow it."
                : "Click a node's indicator for real risks and fixes, or chat on the right for questions and changes — then re-simulate to see it adapt."}
            </p>
          </div>
        </div>
        {!isBlank && (
          <div className="flex shrink-0 items-center gap-2">
            <NewProjectButton />
            <SaveSessionButton />
          </div>
        )}
      </header>

      {isBlank ? (
        <div className="mx-auto mt-10 max-w-xl">
          <ProseInput />
        </div>
      ) : previewVersion ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <VersionHistory />
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <PreviewBanner />
            <SystemDashboard model={previewVersion.model} findingsOverride={previewVersion.findings} />
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <VersionHistory />
            <div className="ml-auto">
              <ResimulateButton model={model} />
            </div>
          </div>

          {/* Three widths, not two: below `lg` everything stacks (Dashboard,
              then Chat, then the — often long — Controls list, so Chat stays
              reachable without scrolling past it); `lg` puts Dashboard and
              Chat side by side with Controls as a full-width row below,
              since the fixed 300px+320px side columns don't leave enough
              room for a real diagram between them yet; `xl` is the original
              3-column layout. */}
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
            <div className="order-3 lg:col-span-2 xl:order-1 xl:col-span-1">
              <ControlPanel model={model} />
            </div>

            <div className="order-1 flex flex-col gap-5 xl:order-2">
              <SystemDashboard model={model} />
              <FailureSidebar model={model} />
            </div>

            <div className="order-2 xl:order-3">
              <ProjectChat />
            </div>
          </div>
        </>
      )}

      <ComponentDetailModal />
    </main>
  );
}
