"use client";

import { referenceModels } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { SystemDashboard } from "../components/SystemDashboard";
import { ControlPanel } from "../components/ControlPanel";
import { FailureSidebar } from "../components/FailureSidebar";
import { ProseInput } from "../components/ProseInput";
import { ActivityIcon } from "../components/icons";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const setModel = useAppStore((s) => s.setModel);

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
            Every node with a possible failure carries an indicator. Click
            one, pick a failure, see its impact, pick a fix, see whether it
            actually resolved it.
          </p>
        </div>
      </header>

      <div className="mt-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {referenceModels.map((m) => (
          <button
            key={m.id}
            onClick={() => setModel(m)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (model.id === m.id
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
            }
          >
            {m.name}
          </button>
        ))}
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
    </main>
  );
}
