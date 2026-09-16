import { simulate } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useScenarios, useBreakingPoint } from "../lib/hooks";
import { scenarioComponentId } from "../lib/scenarioComponentId";
import { ComponentCard } from "./ComponentCard";
import { FindingsList } from "./FindingsList";

export function SystemDashboard({ model }: { model: SystemModel }) {
  const baseline = simulate(model);
  const scenarios = useScenarios(model); // computed once here, sliced per card below
  const breakingPoint = useBreakingPoint(model);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{model.name}</h2>
          <div className="flex items-center gap-2">
            <span
              className={
                "rounded-full px-3 py-1 text-sm font-medium " +
                (baseline.healthy
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800")
              }
            >
              {baseline.healthy ? "Healthy" : "Unhealthy"} at{" "}
              {model.workload.rps.toLocaleString()} rps
            </span>
            <span className="text-xs text-gray-500">
              {breakingPoint
                ? `breaks at ${breakingPoint.rps.toLocaleString()} rps`
                : "not reached below 1,000,000 rps"}
            </span>
          </div>
        </div>
        <div className="mt-2">
          <FindingsList findings={baseline.findings} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ComponentCard
          model={model}
          title="Traffic"
          subtitle="workload-level"
          scenarios={scenarios.filter((s) => scenarioComponentId(s) === null)}
        />
        {model.components.map((component) => (
          <ComponentCard
            key={component.id}
            model={model}
            title={component.label}
            subtitle={`${component.id} · ${component.kind}`}
            scenarios={scenarios.filter(
              (s) => scenarioComponentId(s) === component.id,
            )}
          />
        ))}
      </div>
    </div>
  );
}
