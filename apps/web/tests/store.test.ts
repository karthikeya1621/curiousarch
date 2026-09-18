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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeLocalStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
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

/**
 * Node's test environment has no real `localStorage` (only a browser does),
 * so `sessionStorage.ts`'s own try/catch is exercised for free by every
 * other test in this file (a bare ReferenceError, caught, so nothing here
 * crashes without a stub) — these tests stub in a minimal in-memory
 * Storage-alike to actually exercise the save/restore round trip.
 */
describe("save/restore session", () => {
  it("saveToStorage then hydrateFromStorage round-trips the session, chat included", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    const model = degradedModel();
    const chatMessages = [{ role: "user" as const, text: "why is this a single instance?" }];
    useAppStore.setState({ model, history: [], findings: [], canResimulate: true, chatMessages });

    useAppStore.getState().saveToStorage();
    expect(useAppStore.getState().lastSavedAt).not.toBeNull();

    useAppStore.setState(initialState, true);
    expect(useAppStore.getState().model.components).toHaveLength(0);

    useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().model.id).toBe(model.id);
    expect(useAppStore.getState().canResimulate).toBe(true);
    expect(useAppStore.getState().chatMessages).toEqual(chatMessages);
  });

  it("hydrateFromStorage is a no-op when nothing was saved", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());

    useAppStore.getState().hydrateFromStorage();

    expect(useAppStore.getState().model).toEqual(initialState.model);
  });

  it("degrades gracefully when localStorage is unavailable (private browsing, blocked site data)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked");
      },
      setItem: () => {
        throw new DOMException("blocked");
      },
    });

    expect(() => useAppStore.getState().saveToStorage()).not.toThrow();
    expect(() => useAppStore.getState().hydrateFromStorage()).not.toThrow();
    expect(useAppStore.getState().lastSavedAt).toBeNull();
  });
});

describe("startNewProject", () => {
  it("resets the session to a blank canvas, chat included", () => {
    useAppStore.setState({
      model: degradedModel(),
      history: [degradedModel()],
      canResimulate: true,
      chatMessages: [{ role: "user", text: "hi" }],
    });

    useAppStore.getState().startNewProject();

    const state = useAppStore.getState();
    expect(state.model.components).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(state.canResimulate).toBe(false);
    expect(state.chatMessages).toHaveLength(0);
  });

  it("never touches the saved localStorage slot", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    useAppStore.setState({ model: degradedModel(), history: [] });
    useAppStore.getState().saveToStorage();
    const savedAt = useAppStore.getState().lastSavedAt;

    useAppStore.getState().startNewProject();
    useAppStore.getState().hydrateFromStorage();

    // The saved project comes right back — startNewProject never wrote to
    // (or cleared) the one saved slot itself.
    expect(useAppStore.getState().model.components.length).toBeGreaterThan(0);
    expect(useAppStore.getState().lastSavedAt).toBe(savedAt);
  });
});

describe("sendChatMessage", () => {
  it("answers a question without touching the model", async () => {
    const model = degradedModel();
    useAppStore.setState({ model, chatMessages: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ isQuestion: true, reply: "Because it's a hot key." }))),
    );

    await useAppStore.getState().sendChatMessage("why is the cache TTL short?");

    const state = useAppStore.getState();
    expect(state.chatMessages).toEqual([
      { role: "user", text: "why is the cache TTL short?" },
      { role: "assistant", text: "Because it's a hot key." },
    ]);
    expect(state.model).toBe(model);
    expect(state.canResimulate).toBe(false);
  });

  it("applies a change request exactly like a fix: commits the model and enables Re-simulate", async () => {
    const model = degradedModel();
    const changed = fixedModel();
    useAppStore.setState({ model, chatMessages: [], history: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/chat") {
          return Promise.resolve(
            jsonResponse({ isQuestion: false, reply: "Added a second instance.", model: changed }),
          );
        }
        return Promise.resolve(jsonResponse({ findings: [] }));
      }),
    );

    await useAppStore.getState().sendChatMessage("add another instance");

    const state = useAppStore.getState();
    expect(state.model).toEqual(changed);
    expect(state.canResimulate).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.chatMessages.at(-1)).toEqual({ role: "assistant", text: "Added a second instance." });
  });

  it("surfaces an error without losing the user's own message", async () => {
    useAppStore.setState({ model: degradedModel(), chatMessages: [] });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "boom" }, 502))));

    await useAppStore.getState().sendChatMessage("what happens under load?");

    const state = useAppStore.getState();
    expect(state.chatMessages).toEqual([{ role: "user", text: "what happens under load?" }]);
    expect(state.chatError).toMatch(/boom/);
    expect(state.chatStatus).toBe("idle");
  });
});
