"use client";

import { referenceModels } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { SystemDashboard } from "../components/SystemDashboard";

export default function Home() {
  const model = useAppStore((s) => s.model);
  const setModel = useAppStore((s) => s.setModel);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">archsim</h1>
      <p className="mt-1 text-sm text-gray-600">
        Every node with a possible failure carries an indicator. Click one,
        pick a failure, see its impact, pick a fix, see whether it actually
        resolved it.
      </p>

      <div className="mt-4 flex gap-2">
        {referenceModels.map((m) => (
          <button
            key={m.id}
            onClick={() => setModel(m)}
            className={
              "rounded-full px-3 py-1 text-sm font-medium transition-colors " +
              (model.id === m.id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200")
            }
          >
            {m.name}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <SystemDashboard model={model} />
      </div>
    </main>
  );
}
