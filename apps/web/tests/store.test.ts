/**
 * useAppStore is a Zustand hook, but the hook itself exposes getState/
 * setState statically — no React rendering needed to exercise it.
 * `applyFix`/`commitRework`/`setModel`/`undo` all trigger `refreshFindings`,
 * which hits /api/identify-failures — stubbed here via a mocked global
 * `fetch`, never a live call. Expected model values are derived from the
 * engine's own dormant reference models, same standard as packages/engine's
 * tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

const initialState = useAppStore.getState();

function emptyFindingsResponse(): Response {
  return new Response(JSON.stringify({ findings: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  useAppStore.setState(initialState, true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyFindingsResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function degradedModel(): SystemModel {
  return {
    ...checkout,
    components: checkout.components.map((c) =>
      c.id === "svc" && c.kind === "service"
        ? { ...c, instanceCount: { ...c.instanceCount, value: "single" as const } }
        : c,
    ),
  };
}

function fixedModel(): SystemModel {
  const degraded = degradedModel();
  return {
    ...degraded,
    components: degraded.components.map((c) =>
      c.id === "svc" && c.kind === "service"
        ? { ...c, instanceCount: { ...c.instanceCount, value: "multiple" as const } }
        : c,
    ),
  };
}

describe("applyFix", () => {
  it("commits the given model directly, pushes undo history, and enables Re-simulate", () => {
    useAppStore.setState({ model: degradedModel(), history: [] });

    useAppStore.getState().applyFix(fixedModel());

    const svc = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("multiple");
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().canResimulate).toBe(true);
  });

  it("refreshes findings for the new model", async () => {
    useAppStore.setState({ model: degradedModel(), history: [] });

    useAppStore.getState().applyFix(fixedModel());

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/identify-failures",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pushes undo history so the fix can be reverted", () => {
    useAppStore.setState({ model: degradedModel(), history: [] });

    useAppStore.getState().applyFix(fixedModel());
    expect(useAppStore.getState().history).toHaveLength(1);

    useAppStore.getState().undo();
    const svc = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svc?.kind !== "service") throw new Error("expected service");
    expect(svc.instanceCount.value).toBe("single"); // reverted
  });

  it("clears the transient finding/fix/open-node selections", () => {
    useAppStore.setState({
      model: degradedModel(),
      selectedFindingId: "svc:SINGLE_POINT_OF_FAILURE",
      selectedFixId: "svc:add-instance",
      openComponentId: "svc",
    });

    useAppStore.getState().applyFix(fixedModel());

    const state = useAppStore.getState();
    expect(state.selectedFindingId).toBeNull();
    expect(state.selectedFixId).toBeNull();
    expect(state.openComponentId).toBeNull();
  });
});

describe("setWorkloadTier", () => {
  it("updates the tier and enables Re-simulate without refreshing findings", () => {
    const model: SystemModel = {
      ...checkout,
      workload: { ...checkout.workload, users: { included: true, tier: 100, target: 1_000_000 } },
    };
    useAppStore.setState({ model, history: [], canResimulate: false });

    useAppStore.getState().setWorkloadTier("users", 10_000);

    expect(useAppStore.getState().model.workload.users?.tier).toBe(10_000);
    expect(useAppStore.getState().canResimulate).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
