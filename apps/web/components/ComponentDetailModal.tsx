"use client";

import { isTrait } from "@archsim/engine";
import type { Component, Trait } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { Modal } from "./Modal";
import { Badge, type BadgeTone } from "./Badge";
import { WrenchIcon, XIcon } from "./icons";
import { KIND_ICON, KIND_TONE } from "./kindStyle";

const PROVENANCE_TONE: Record<Trait<unknown>["provenance"], BadgeTone> = {
  stated: "info",
  inferred: "violet",
  default: "neutral",
};

function componentTraits(component: Component): [string, Trait<unknown>][] {
  return Object.entries(component).filter((entry): entry is [string, Trait<unknown>] =>
    isTrait(entry[1]),
  );
}

/**
 * Moved here from ControlPanel.tsx's always-visible left-column list —
 * that column was narrow enough to truncate rationale text; this has the
 * room to show it in full. Reads `viewingComponent` as the actual clicked
 * object (see `viewingComponent` in lib/store/slices/selectionSlice.ts), not a lookup by id, so this shows
 * the right data whether the diagram on screen is the live model or a
 * previewed past version.
 */
export function ComponentDetailModal() {
  const component = useAppStore((s) => s.viewingComponent);
  const closeComponentDetail = useAppStore((s) => s.closeComponentDetail);
  const appliedFixes = useAppStore((s) => s.appliedFixes);
  const pendingFixes = useAppStore((s) => s.pendingFixes);

  if (!component) return null;

  const traits = componentTraits(component);
  // One chronological list, not two separate sections — a queued fix and
  // an applied one are the same kind of event at different stages, and
  // `commitRework` always moves the former into the latter, so a
  // component rarely has more than a couple of entries either way.
  const fixesHere = [
    ...pendingFixes
      .filter((f) => f.componentId === component.id)
      .map((f) => ({ status: "queued" as const, fixLabel: f.fixLabel, findingTitle: f.findingTitle, at: f.queuedAt })),
    ...appliedFixes
      .filter((f) => f.componentId === component.id)
      .map((f) => ({ status: "applied" as const, fixLabel: f.fixLabel, findingTitle: f.findingTitle, at: f.appliedAt })),
  ].sort((a, b) => b.at - a.at);
  const KindIcon = KIND_ICON[component.kind];

  return (
    <Modal open={Boolean(component)} onClose={closeComponentDetail} widthClassName="max-w-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${KIND_TONE[component.kind]}`}>
            <KindIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{component.label}</p>
            <p className="truncate text-[11px] text-slate-400">
              {component.id} · {component.kind}
            </p>
          </div>
        </div>
        <button
          onClick={closeComponentDetail}
          aria-label="Close"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {traits.length > 0 && (
        <div className="mt-4 flex max-h-64 flex-col divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
          {traits.map(([field, trait]) => (
            <div key={field} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{field}</span>
                  <Badge tone={PROVENANCE_TONE[trait.provenance]}>{trait.provenance}</Badge>
                </div>
                <p className="text-[11px] text-slate-400">{trait.rationale}</p>
              </div>
              <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                {typeof trait.value === "boolean" ? (trait.value ? "on" : "off") : String(trait.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Fixes for this component
        </p>
        {fixesHere.length === 0 ? (
          <p className="mt-1.5 text-xs text-slate-400">No fixes chosen for this component yet.</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {fixesHere.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-900">
                <WrenchIcon
                  className={"mt-0.5 h-3 w-3 shrink-0 " + (f.status === "queued" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{f.fixLabel}</span>
                    <Badge tone={f.status === "queued" ? "warning" : "success"}>
                      {f.status === "queued" ? "Queued" : "Applied"}
                    </Badge>
                  </div>
                  <p className="text-slate-400">for: {f.findingTitle}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
