import { USER_TIERS, REQUEST_TIERS } from "@archsim/engine";
import type { SystemModel, WorkloadDimensionValue } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { formatTier } from "../lib/formatTier";
import { highestReachableTier } from "../lib/workloadTiers";
import { Card } from "./Card";
import { UndoIcon } from "./icons";

function SegmentedToggle({
  options,
  value,
  onChange,
  label,
  disabledOptions = {},
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** option -> why it can't be chosen right now (shown as its tooltip). */
  disabledOptions?: Record<string, string>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700"
    >
      {options.map((opt) => (
        <button
          key={opt}
          role="radio"
          aria-checked={opt === value}
          onClick={() => onChange(opt)}
          disabled={opt in disabledOptions}
          title={disabledOptions[opt]}
          className={
            "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
            (opt === value
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-700")
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
 * — see lib/store/findings.ts on why `setWorkloadTier` never triggers a
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
  // One rung above the last simulated tier at most (lib/workloadTiers.ts):
  // Re-simulate at each step so failures show up one scale at a time.
  const baselineTier = useAppStore((s) => s.baselineModel?.workload[dimension]?.tier);
  const reachable = highestReachableTier(ladder, baselineTier);
  const disabledOptions: Record<string, string> = {};
  for (const t of ladder) {
    if (t > reachable) disabledOptions[formatTier(t)] = `Re-simulate at ${formatTier(reachable)} first — scale up one step at a time`;
  }

  return (
    <div className="border-b border-slate-100 pb-3 pt-2 last:border-b-0 dark:border-slate-700">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      <div className="mt-1.5">
        <SegmentedToggle
          options={options}
          value={formatTier(value.tier)}
          label={label}
          disabledOptions={disabledOptions}
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
  // Enabled only when a control actually differs from the last simulation's
  // values (and there IS a baseline to go back to) — not a step-back through
  // history: it puts the controls where the last Re-simulate left them.
  const canRevert = useAppStore((s) => s.parametersChangedSinceResimulate && s.baselineModel !== null);
  const revertParameters = useAppStore((s) => s.revertParameters);

  // Blank canvas — nothing to control until a system exists.
  if (model.components.length === 0) return null;

  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Controls
        </h3>
        <button
          onClick={revertParameters}
          disabled={!canRevert}
          title="Put the controls back to the values the last simulation used"
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:enabled:hover:border-slate-500 dark:enabled:hover:bg-slate-700"
        >
          <UndoIcon className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      {model.workload.users?.included && (
        <TierControl dimension="users" value={model.workload.users} />
      )}
      {model.workload.requests?.included && (
        <TierControl dimension="requests" value={model.workload.requests} />
      )}

      <div className="pt-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Click any node in the diagram to see its properties and fix history.
        </p>
      </div>
    </Card>
  );
}
