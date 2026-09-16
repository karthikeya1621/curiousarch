import { simulate } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useBreakingPoint } from "../lib/hooks";
import { FlowDiagram } from "./FlowDiagram";
import { FindingsList } from "./FindingsList";
import { Card } from "./Card";
import { Badge } from "./Badge";

export function SystemDashboard({ model }: { model: SystemModel }) {
  const baseline = simulate(model);
  const breakingPoint = useBreakingPoint(model);

  const breakingPointText = !breakingPoint
    ? "not reached below 1,000,000 rps"
    : baseline.healthy
      ? `breaks around ${breakingPoint.rps.toLocaleString()} rps`
      : `over capacity since ${breakingPoint.rps.toLocaleString()} rps`;

  return (
    <div className="flex flex-col gap-5">
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {model.name}
          </h2>
          <div className="flex items-center gap-2">
            <Badge tone={baseline.healthy ? "success" : "critical"}>
              {baseline.healthy ? "Healthy" : "Unhealthy"} at{" "}
              {model.workload.rps.toLocaleString()} rps
            </Badge>
            <span className="text-xs text-slate-400">{breakingPointText}</span>
          </div>
        </div>
        <div className="mt-3">
          <FindingsList findings={baseline.findings} />
        </div>
      </Card>

      <FlowDiagram model={model} />
    </div>
  );
}
