import { isParameter } from "@archsim/engine";
import type { Component, Parameter, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useBreakingPoint } from "../lib/hooks";
import { Card } from "./Card";
import { Badge, type BadgeTone } from "./Badge";
import { UndoIcon } from "./icons";

const PROVENANCE_TONE: Record<Parameter["provenance"], BadgeTone> = {
  stated: "info",
  inferred: "violet",
  default: "neutral",
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
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-700">{field}</span>
          <Badge tone={PROVENANCE_TONE[param.provenance]}>{param.provenance}</Badge>
        </div>
        <p className="truncate text-[11px] text-slate-400">{param.rationale}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          value={param.value}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value)) updateParameter(componentId, field, value);
          }}
          className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-sm text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none"
        />
        <span className="w-10 shrink-0 text-xs text-slate-400">{param.unit}</span>
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
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Controls</h3>
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <UndoIcon className="h-3.5 w-3.5" />
          Undo
        </button>
      </div>

      <div className="border-b border-slate-100 pb-3 pt-2">
        <div className="flex items-center justify-between text-xs text-slate-700">
          <span className="font-medium">Traffic</span>
          <span className="font-mono">{model.workload.rps.toLocaleString()} rps</span>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(sliderMax, 1)}
          value={model.workload.rps}
          onChange={(e) => setWorkloadRps(Number(e.target.value))}
          className="mt-2 w-full accent-slate-900"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          {breakingPoint
            ? `Breaks around ${breakingPoint.rps.toLocaleString()} rps`
            : "No breaking point found below the simulator's ceiling"}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-slate-100">
        {model.components.map((component) => {
          const params = componentParameters(component);
          if (params.length === 0) return null;
          return (
            <div key={component.id} className="py-1">
              <p className="pt-2 text-xs font-semibold text-slate-800">
                {component.label}{" "}
                <span className="font-normal text-slate-400">· {component.id}</span>
              </p>
              <div className="flex flex-col divide-y divide-slate-50">
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
    </Card>
  );
}
