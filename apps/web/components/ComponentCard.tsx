import { useState } from "react";
import type { Scenario, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { FailurePanel } from "./FailurePanel";

/**
 * Takes a title/subtitle/scenario-slice rather than a raw Component, so the
 * same card renders both real components and the workload-level "Traffic"
 * pseudo-card uniformly — neither needs a component id to match against,
 * since "is one of my own scenarios selected" is just a membership check.
 */
export function ComponentCard({
  model,
  title,
  subtitle,
  scenarios,
}: {
  model: SystemModel;
  title: string;
  subtitle: string;
  scenarios: Scenario[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedScenarioId = useAppStore((s) => s.selectedScenarioId);
  const selectScenario = useAppStore((s) => s.selectScenario);

  const activeScenario: Scenario | undefined = scenarios.find(
    (s) => s.id === selectedScenarioId,
  );
  const hasFailures = scenarios.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        {hasFailures && (
          <button
            onClick={() => setIsOpen((v) => !v)}
            title={`${scenarios.length} possible failure(s)`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white hover:bg-amber-500"
          >
            {scenarios.length}
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-100 pt-3">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => selectScenario(s.id)}
              className={
                "rounded border px-2 py-1.5 text-left text-sm transition-colors " +
                (selectedScenarioId === s.id
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50")
              }
            >
              <span className="font-medium">{s.label}</span>
              <p className="text-xs text-gray-500">{s.description}</p>
            </button>
          ))}
        </div>
      )}

      {activeScenario && (
        <FailurePanel model={model} scenarioId={activeScenario.id} />
      )}
    </div>
  );
}
