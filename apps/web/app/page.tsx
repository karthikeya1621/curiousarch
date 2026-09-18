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
import { ActivityIcon } from "../components/icons";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const hydrateFromStorage = useAppStore((s) => s.hydrateFromStorage);
  const isBlank = model.components.length === 0;

  // Client-only, post-mount: the store's initial state (blank canvas) must
  // match on the server-rendered and first client render to avoid a
  // hydration mismatch, so restoring a saved session has to happen after
  // that first render, not during it.
  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  return (
    <main className="w-full px-6 py-5 lg:px-10">
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
                : "Every node with a possible failure carries an indicator. Click one, pick a finding, pick a fix, see how the architecture adapts."}
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
      ) : (
        <>
          <div className="mt-4 flex justify-end">
            <ResimulateButton model={model} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
            <div className="order-2 xl:order-1">
              <ControlPanel model={model} />
            </div>

            <div className="order-1 flex flex-col gap-5 xl:order-2">
              <SystemDashboard model={model} />
              <FailureSidebar model={model} />
            </div>

            <div className="order-3">
              <ProjectChat />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
