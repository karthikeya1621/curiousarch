import { USER_TIERS, REQUEST_TIERS } from "@archsim/engine";
import type { SystemModel, WorkloadDimensionValue } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { formatTier } from "../lib/formatTier";
import { Card } from "./Card";
import { UndoIcon } from "./icons";

function SegmentedToggle({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-slate-200 p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          role="radio"
          aria-checked={opt === value}
          onClick={() => onChange(opt)}
          className={
            "rounded px-2 py-0.5 text-xs font-medium transition-colors " +
            (opt === value ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100")
          }
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/**
 * The only interactive control in this app — everything else evolves via
 * a fix or a fresh description. Raising the tier here is a passive
 * setting change (it enables Re-simulate but doesn't call the AI itself)
 * — see store.ts's own comment on why `setWorkloadTier` never triggers a
 * findings refresh on its own.
 */
function TierControl({
  dimension,
  value,
}: {
  dimension: "users" | "requests";
  value: WorkloadDimensionValue;
}) {
  const setWorkloadTier = useAppStore((s) => s.setWorkloadTier);
  const ladder = dimension === "users" ? USER_TIERS : REQUEST_TIERS;
  const label = dimension === "users" ? "Users" : "Requests";
  const options = ladder.map(formatTier);

  return (
    <div className="border-b border-slate-100 pb-3 pt-2 last:border-b-0">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1.5">
        <SegmentedToggle
          options={options}
          value={formatTier(value.tier)}
          label={label}
          onChange={(next) => {
            const tier = ladder.find((t) => formatTier(t) === next);
            if (tier !== undefined) setWorkloadTier(dimension, tier);
          }}
        />
      </div>
      {value.target !== value.tier && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          Target: {formatTier(value.target)} — from your description
        </p>
      )}
    </div>
  );
}

export function ControlPanel({ model }: { model: SystemModel }) {
  const history = useAppStore((s) => s.history);
  const undo = useAppStore((s) => s.undo);

  // Blank canvas — nothing to control until a system exists.
  if (model.components.length === 0) return null;

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

      {model.workload.users?.included && <TierControl dimension="users" value={model.workload.users} />}
      {model.workload.requests?.included && (
        <TierControl dimension="requests" value={model.workload.requests} />
      )}

      <div className="border-t border-slate-100 pt-2">
        <p className="text-xs text-slate-500">
          Click any node in the diagram to see its properties and fix history.
        </p>
      </div>
    </Card>
  );
}
