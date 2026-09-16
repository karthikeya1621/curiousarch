/**
 * useAppStore is a Zustand hook, but the hook itself exposes getState/
 * setState statically — no React rendering needed to exercise it. Expected
 * values are derived from the engine's own reference-model numbers, same
 * standard as packages/engine's tests.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { checkout, listFixes } from "@archsim/engine";
import { useAppStore } from "../lib/store";

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState, true);
});

describe("applyFix", () => {
  it("applies the fix to the real model, not the hypothetical failure+fix combination", () => {
    useAppStore.setState({ model: checkout });
    const fix = listFixes(checkout, "workload:traffic-10x").find((f) => f.id === "db:pool-2x")!;

    // fix.apply(checkout) directly — never fix.apply(scenario.apply(checkout)).
    // Confirms the store commits the fix against the real baseline: checkout
    // is healthy and untouched by the traffic-10x scenario, so the only
    // change should be the pool doubling, nothing scenario-related.
    useAppStore.getState().applyFix(fix.apply(checkout));

    const db = useAppStore.getState().model.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.connectionPoolSize.value).toBe(80); // 40 * 2
    expect(db.queryTimeMs.value).toBe(25); // untouched by traffic-10x's own changes
  });

  it("pushes undo history so the fix can be reverted", () => {
    useAppStore.setState({ model: checkout, history: [] });
    const fix = listFixes(checkout, "workload:traffic-10x").find((f) => f.id === "db:pool-2x")!;

    useAppStore.getState().applyFix(fix.apply(checkout));
    expect(useAppStore.getState().history).toHaveLength(1);

    useAppStore.getState().undo();
    const db = useAppStore.getState().model.components.find((c) => c.id === "db");
    if (db?.kind !== "database") throw new Error("expected database");
    expect(db.connectionPoolSize.value).toBe(40); // reverted
  });

  it("clears the transient scenario/fix/open-node selections", () => {
    useAppStore.setState({
      model: checkout,
      selectedScenarioId: "workload:traffic-10x",
      selectedFixId: "db:pool-2x",
      openComponentId: "db",
    });
    const fix = listFixes(checkout, "workload:traffic-10x").find((f) => f.id === "db:pool-2x")!;

    useAppStore.getState().applyFix(fix.apply(checkout));

    const state = useAppStore.getState();
    expect(state.selectedScenarioId).toBeNull();
    expect(state.selectedFixId).toBeNull();
    expect(state.openComponentId).toBeNull();
  });
});
