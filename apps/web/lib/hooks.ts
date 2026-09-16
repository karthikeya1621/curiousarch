import { useMemo } from "react";
import {
  listScenarios,
  compareScenario,
  listFixes,
  compareFix,
  findBreakingPoint,
} from "@archsim/engine";
import type { SystemModel, Scenario, ScenarioDelta, Fix, FixResult, Finding } from "@archsim/engine";

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

export function useFixResult(
  model: SystemModel,
  scenarioId: string | null,
  fixId: string | null,
): FixResult | null {
  return useMemo(() => {
    if (!scenarioId || !fixId) return null;
    try {
      return compareFix(model, scenarioId, fixId);
    } catch {
      return null;
    }
  }, [model, scenarioId, fixId]);
}

export function useBreakingPoint(
  model: SystemModel,
): { rps: number; findings: Finding[] } | null {
  return useMemo(() => findBreakingPoint(model), [model]);
}
