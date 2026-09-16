import { isParameter } from "@archsim/engine";
import type { Component, Parameter, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useBreakingPoint } from "../lib/hooks";

const PROVENANCE_STYLE: Record<Parameter["provenance"], string> = {
  stated: "bg-blue-100 text-blue-800",
  inferred: "bg-purple-100 text-purple-800",
  default: "bg-gray-100 text-gray-600",
};

function ParameterRow({
  componentId,
  field,
  param,
}: {
  componentId: string;
  field: string;
  param: Parameter;
}) {
  const updateParameter = useAppStore((s) => s.updateParameter);

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-gray-700">{field}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PROVENANCE_STYLE[param.provenance]}`}
          >
            {param.provenance}
          </span>
        </div>
        <p className="truncate text-[11px] text-gray-500">{param.rationale}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <input
          type="number"
          value={param.value}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value)) updateParameter(componentId, field, value);
          }}
          className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm"
        />
        <span className="text-xs text-gray-500">{param.unit}</span>
      </div>
    </div>
  );
}

function componentParameters(component: Component): [string, Parameter][] {
  return Object.entries(component).filter((entry): entry is [string, Parameter] =>
    isParameter(entry[1]),
  );
}

export function ControlPanel({ model }: { model: SystemModel }) {
  const setWorkloadRps = useAppStore((s) => s.setWorkloadRps);
  const history = useAppStore((s) => s.history);
  const undo = useAppStore((s) => s.undo);
  const breakingPoint = useBreakingPoint(model);

  // Range the traffic slider so the break (if any) is reachable by dragging.
  const sliderMax = breakingPoint ? breakingPoint.rps * 2 : model.workload.rps * 4;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Controls</h3>
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Undo
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-700">
          <span className="font-medium">Traffic</span>
          <span>{model.workload.rps.toLocaleString()} rps</span>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(sliderMax, 1)}
          value={model.workload.rps}
          onChange={(e) => setWorkloadRps(Number(e.target.value))}
          className="mt-1 w-full"
        />
        <p className="mt-0.5 text-[11px] text-gray-500">
          {breakingPoint
            ? `Breaks around ${breakingPoint.rps.toLocaleString()} rps`
            : "No breaking point found below the simulator's ceiling"}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-gray-100 border-t border-gray-100 pt-1">
        {model.components.map((component) => {
          const params = componentParameters(component);
          if (params.length === 0) return null;
          return (
            <div key={component.id} className="py-2">
              <p className="text-xs font-semibold text-gray-800">
                {component.label} <span className="text-gray-400">· {component.id}</span>
              </p>
              <div className="mt-1 flex flex-col divide-y divide-gray-50">
                {params.map(([field, param]) => (
                  <ParameterRow
                    key={field}
                    componentId={component.id}
                    field={field}
                    param={param}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
