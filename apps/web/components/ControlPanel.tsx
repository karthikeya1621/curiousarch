import { isTrait, USER_TIERS, REQUEST_TIERS } from "@archsim/engine";
import type { Component, Trait, SystemModel, WorkloadDimensionValue } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { formatTier } from "../lib/formatTier";
import { Card } from "./Card";
import { Badge, type BadgeTone } from "./Badge";
import { UndoIcon } from "./icons";

const PROVENANCE_TONE: Record<Trait<unknown>["provenance"], BadgeTone> = {
  stated: "info",
  inferred: "violet",
  default: "neutral",
};

function SegmentedToggle({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-slate-200 p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
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

/**
 * Read-only: traits are no longer a control surface. This app's whole
 * premise is that the architecture only evolves by applying a fix to a
 * real failure point (or by re-describing the system) — a free toggle
 * here would let you route around that loop entirely. Provenance and
 * rationale stay visible for exactly the reason they always were —
 * understanding what was assumed and why — just without a way to
 * hand-edit it.
 */
function TraitRow({ field, trait }: { field: string; trait: Trait<unknown> }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-700">{field}</span>
          <Badge tone={PROVENANCE_TONE[trait.provenance]}>{trait.provenance}</Badge>
        </div>
        <p className="truncate text-[11px] text-slate-400">{trait.rationale}</p>
      </div>
      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
        {typeof trait.value === "boolean" ? (trait.value ? "on" : "off") : String(trait.value)}
      </span>
    </div>
  );
}

function componentTraits(component: Component): [string, Trait<unknown>][] {
  return Object.entries(component).filter((entry): entry is [string, Trait<unknown>] =>
    isTrait(entry[1]),
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
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          System — read-only, evolves via fixes
        </p>
        <div className="flex flex-col divide-y divide-slate-100">
          {model.components.map((component) => {
            const traits = componentTraits(component);
            if (traits.length === 0) return null;
            return (
              <div key={component.id} className="py-1">
                <p className="pt-2 text-xs font-semibold text-slate-800">
                  {component.label}{" "}
                  <span className="font-normal text-slate-400">· {component.id}</span>
                </p>
                <div className="flex flex-col divide-y divide-slate-50">
                  {traits.map(([field, trait]) => (
                    <TraitRow key={field} field={field} trait={trait} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
