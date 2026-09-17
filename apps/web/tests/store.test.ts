/**
 * useAppStore is a Zustand hook, but the hook itself exposes getState/
 * setState statically — no React rendering needed to exercise it. Expected
 * values are derived from the engine's own reference-model traits, same
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
    const fix = listFixes(checkout, "svc:loses-instance").find((f) => f.id === "svc:add-instance")!;

    // fix.apply(checkout) directly — never fix.apply(scenario.apply(checkout)).
    // Confirms the store commits the fix against the real baseline: checkout
    // was never actually degraded by the "loses an instance" scenario, so
    // the only change should be the instance count, nothing scenario-related.
    useAppStore.getState().applyFix(fix.apply(checkout));

    const svc = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("multiple");
  });

  it("pushes undo history so the fix can be reverted", () => {
    useAppStore.setState({ model: checkout, history: [] });
    const degraded = {
      ...checkout,
      components: checkout.components.map((c) =>
        c.id === "svc" && c.kind === "service"
          ? { ...c, instanceCount: { ...c.instanceCount, value: "single" as const } }
          : c,
      ),
    };
    useAppStore.setState({ model: degraded });
    const fix = listFixes(degraded, "workload:scale-up").find((f) => f.id === "svc:add-instance")!;

    useAppStore.getState().applyFix(fix.apply(degraded));
    expect(useAppStore.getState().history).toHaveLength(1);

    useAppStore.getState().undo();
    const svc = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("single"); // reverted
  });

  it("clears the transient scenario/fix/open-node selections", () => {
    useAppStore.setState({
      model: checkout,
      selectedScenarioId: "svc:loses-instance",
      selectedFixId: "svc:add-instance",
      openComponentId: "svc",
    });
    const fix = listFixes(checkout, "svc:loses-instance").find((f) => f.id === "svc:add-instance")!;

    useAppStore.getState().applyFix(fix.apply(checkout));

    const state = useAppStore.getState();
    expect(state.selectedScenarioId).toBeNull();
    expect(state.selectedFixId).toBeNull();
    expect(state.openComponentId).toBeNull();
  });
});
