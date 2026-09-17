import { useEffect, useMemo, useState } from "react";
import {
  listScenarios,
  compareScenario,
  listFixes,
  compareFix,
  findBreakingTier,
} from "@archsim/engine";
import type { SystemModel, Scenario, ScenarioDelta, Fix, FixResult, Finding, ScaleTier } from "@archsim/engine";
import { fixComponentId } from "./fixComponentId";

/**
 * Every component derives from the engine through these four hooks, never
 * calling listScenarios/compareScenario/listFixes/compareFix directly —
 * keeps dependency arrays correct in one place instead of drifting per
 * call site. compareScenario/compareFix throw on an unknown scenario/fix
 * id (the store's invariants should prevent that, but a throw inside a
 * render-phase useMemo takes down the tree with no error boundary), so the
 * two comparison hooks return null on failure and components treat that as
 * "selection invalid, fall back to the indicator list."
 */

export function useScenarios(model: SystemModel): Scenario[] {
  return useMemo(() => listScenarios(model), [model]);
}

export function useScenarioDelta(
  model: SystemModel,
  scenarioId: string | null,
): ScenarioDelta | null {
  return useMemo(() => {
    if (!scenarioId) return null;
    try {
      return compareScenario(model, scenarioId);
    } catch {
      return null;
    }
  }, [model, scenarioId]);
}

export function useFixes(model: SystemModel, scenarioId: string | null): Fix[] {
  return useMemo(() => {
    if (!scenarioId) return [];
    try {
      return listFixes(model, scenarioId);
    } catch {
      return [];
    }
  }, [model, scenarioId]);
}

export interface UseFixResultReturn {
  result: FixResult | null;
  /**
   * "idle" for the 6 deterministic fixes (no network call ever fires) —
   * "loading"/"done" only apply to a fix with `hasAiProposal: true`.
   */
  proposalStatus: "idle" | "loading" | "done";
  proposalError: string | null;
  /**
   * Whatever `result` was actually computed with — `undefined` means
   * fixes.ts's own hardcoded defaults. Exposed so "Apply this fix" commits
   * the exact values that were just previewed, not a fresh (and possibly
   * different, if the AI call resolves between preview and click) result.
   */
  proposedTraits: Record<string, unknown> | undefined;
}

/**
 * Progressive, non-blocking by design: `result` is always computed
 * immediately with whatever `proposedTraits` is currently known (`undefined`
 * at first, meaning fixes.ts's own hardcoded defaults apply) so the panel
 * never blank-loads. For a fix with `hasAiProposal`, an effect fires the one
 * AI call this app makes when applying a fix, and once it resolves,
 * `proposedTraits` updates and `result` recomputes with the AI's values —
 * upgrading the preview in place rather than gating it behind a spinner.
 */
export function useFixResult(
  model: SystemModel,
  scenarioId: string | null,
  fixId: string | null,
): UseFixResultReturn {
  const fixes = useFixes(model, scenarioId);
  const fix = fixId ? (fixes.find((f) => f.id === fixId) ?? null) : null;

  const [proposedTraits, setProposedTraits] = useState<Record<string, unknown> | undefined>(
    undefined,
  );
  const [proposalStatus, setProposalStatus] = useState<"idle" | "loading" | "done">("idle");
  const [proposalError, setProposalError] = useState<string | null>(null);

  useEffect(() => {
    setProposedTraits(undefined);
    setProposalError(null);

    if (!fix || !fix.hasAiProposal) {
      setProposalStatus("idle");
      return;
    }

    let cancelled = false;
    setProposalStatus("loading");

    fetch("/api/propose-fix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, componentId: fixComponentId(fix) }),
    })
      .then(async (res) => {
        const responseBody = await res.json();
        if (!res.ok) throw new Error(responseBody.error ?? "Proposal failed.");
        if (cancelled) return;
        setProposedTraits(responseBody.proposal as Record<string, unknown>);
        setProposalStatus("done");
      })
      .catch((err) => {
        if (cancelled) return;
        setProposalError(err instanceof Error ? err.message : "Proposal failed.");
        setProposalStatus("done"); // fixes.ts's own defaults still apply — see fixes.ts's UNCACHED_DATABASE_AT_SCALE factory
      });

    return () => {
      cancelled = true;
    };
  }, [model, scenarioId, fix?.id, fix?.hasAiProposal]);

  const result = useMemo(() => {
    if (!scenarioId || !fixId) return null;
    try {
      return compareFix(model, scenarioId, fixId, proposedTraits);
    } catch {
      return null;
    }
  }, [model, scenarioId, fixId, proposedTraits]);

  return { result, proposalStatus, proposalError, proposedTraits };
}

export function useBreakingTier(
  model: SystemModel,
): { scale: ScaleTier; findings: Finding[] } | null {
  return useMemo(() => findBreakingTier(model), [model]);
}
