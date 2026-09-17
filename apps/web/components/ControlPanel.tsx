import { isTrait } from "@archsim/engine";
import type { Component, ScaleTier, Trait, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { useBreakingTier } from "../lib/hooks";
import { Card } from "./Card";
import { Badge, type BadgeTone } from "./Badge";
import { UndoIcon } from "./icons";

const PROVENANCE_TONE: Record<Trait<unknown>["provenance"], BadgeTone> = {
  stated: "info",
  inferred: "violet",
  default: "neutral",
};

const SCALE_TIERS: ScaleTier[] = ["small", "medium", "large", "massive"];

/**
 * Every enum trait in this app has exactly two options — but which two
 * depends on kind, not just field name (both service and database have an
 * `instanceCount` field, with different second options). Small and
 * explicit rather than trying to derive this from the Zod schema at
 * runtime, which would mean shipping schema internals to the client.
 */
const ENUM_OPTIONS: Partial<Record<Component["kind"], Record<string, [string, string]>>> = {
  service: { instanceCount: ["single", "multiple"] },
  cache: { ttl: ["short", "long"], keyspaceSize: ["small", "large"] },
  database: { instanceCount: ["single", "has-replicas"], writeVolume: ["low", "high"] },
  queue: { consumerScaling: ["fixed", "auto"] },
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

function BooleanSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-slate-900" : "bg-slate-200"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function TraitRow({
  componentId,
  kind,
  field,
  trait,
}: {
  componentId: string;
  kind: Component["kind"];
  field: string;
  trait: Trait<unknown>;
}) {
  const updateTrait = useAppStore((s) => s.updateTrait);

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-700">{field}</span>
          <Badge tone={PROVENANCE_TONE[trait.provenance]}>{trait.provenance}</Badge>
        </div>
        <p className="truncate text-[11px] text-slate-400">{trait.rationale}</p>
      </div>
      <div className="shrink-0">
        {typeof trait.value === "boolean" ? (
          <BooleanSwitch
            checked={trait.value}
            onChange={(next) => updateTrait(componentId, field, next)}
          />
        ) : (
          <SegmentedToggle
            options={ENUM_OPTIONS[kind]?.[field] ?? [String(trait.value)]}
            value={String(trait.value)}
            onChange={(next) => updateTrait(componentId, field, next)}
          />
        )}
      </div>
    </div>
  );
}

function componentTraits(component: Component): [string, Trait<unknown>][] {
  return Object.entries(component).filter((entry): entry is [string, Trait<unknown>] =>
    isTrait(entry[1]),
  );
}

export function ControlPanel({ model }: { model: SystemModel }) {
  const setWorkloadScale = useAppStore((s) => s.setWorkloadScale);
  const history = useAppStore((s) => s.history);
  const undo = useAppStore((s) => s.undo);
  const breakingTier = useBreakingTier(model);

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
        <span className="text-xs font-medium text-slate-700">Traffic scale</span>
        <div className="mt-1.5">
          <SegmentedToggle
            options={SCALE_TIERS}
            value={model.workload.scale.value}
            onChange={(next) => setWorkloadScale(next as ScaleTier)}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          {breakingTier
            ? `Breaks at ${breakingTier.scale} scale`
            : "No risk found at any scale"}
        </p>
      </div>

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
                  <TraitRow
                    key={field}
                    componentId={component.id}
                    kind={component.kind}
                    field={field}
                    trait={trait}
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
