"use client";

import { useAppStore } from "../lib/store";
import { SystemDashboard } from "../components/SystemDashboard";
import { ControlPanel } from "../components/ControlPanel";
import { FailureSidebar } from "../components/FailureSidebar";
import { ProseInput } from "../components/ProseInput";
import { ResimulateButton } from "../components/ResimulateButton";
import { ActivityIcon } from "../components/icons";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const isBlank = model.components.length === 0;

  return (
    <main className="w-full px-6 py-8 lg:px-10">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <ActivityIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            archsim
          </h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            {isBlank
              ? "Describe a system to get started — an AI architect will sketch it, flag what could go wrong, and suggest fixes as you grow it."
              : "Every node with a possible failure carries an indicator. Click one, pick a finding, pick a fix, see how the architecture adapts."}
          </p>
        </div>
      </header>

      {isBlank ? (
        <div className="mx-auto mt-10 max-w-xl">
          <ProseInput />
        </div>
      ) : (
        <>
          <div className="mt-6 flex justify-end">
            <ResimulateButton model={model} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
            <div className="order-2 xl:order-1">
              <ControlPanel model={model} />
            </div>

            <div className="order-1 flex flex-col gap-5 xl:order-2">
              <SystemDashboard model={model} />
              <FailureSidebar model={model} />
            </div>

            <div className="order-3">
              <ProseInput />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
