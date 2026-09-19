/**
 * useAppStore is a Zustand hook, but the hook itself exposes getState/
 * setState statically — no React rendering needed to exercise it.
 * `setModel`/`commitRework`/`undo` trigger `refreshFindings`, which hits
 * /api/identify-failures — stubbed here via a mocked global `fetch`,
 * never a live call. `applyFix` (and chat's change path, which commits
 * through it) deliberately does NOT — it only marks findings stale, to
 * avoid spending an extra live call on every fix/chat change; only an
 * explicit Re-simulate (`commitRework`) actually refreshes them. Expected
 * model values are derived from the engine's own dormant reference
 * models, same standard as packages/engine's tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

/**
 * `vi.hoisted` because `vi.mock` calls (and their factories) are hoisted
 * above regular imports — a plain `let` declared after the imports would
 * still be in the temporal dead zone the first time the mocked module is
 * actually resolved. `authState.userId: null` simulates the "not logged
 * in" path that `sessionStorage.ts` degrades on (unreachable in the real
 * app once middleware.ts gates every page, but still real defensive code —
 * e.g. a session expiring mid-session).
 *
 * `fakeProjects` is a minimal in-memory stand-in for the `projects` table
 * — a chainable builder covering exactly the query shapes
 * `sessionStorage.ts` actually sends (insert().select().single(),
 * update().eq().eq(), select().eq().eq().maybeSingle(),
 * select().eq().order(), delete().eq().eq()), not a general Postgrest
 * emulation.
 */
const { fakeProjects, authState, nextId } = vi.hoisted(() => ({
  fakeProjects: new Map<string, Record<string, unknown>>(),
  authState: { userId: "test-user" as string | null, dbError: false },
  nextId: { current: 1 },
}));

function makeQuery() {
  let op: "insert" | "update" | "select" | "delete" | null = null;
  let payload: Record<string, unknown> | null = null;
  let orderCol: string | null = null;
  let orderAscending = true;
  const filters: [string, unknown][] = [];

  async function exec(): Promise<{ data: unknown; error: Error | null }> {
    if (authState.dbError) return { data: null, error: new Error("blocked") };
    const matches = (row: Record<string, unknown>) => filters.every(([k, v]) => row[k] === v);

    if (op === "insert") {
      const id = `project-${nextId.current++}`;
      const row = { id, ...payload };
      fakeProjects.set(id, row);
      return { data: row, error: null };
    }
    if (op === "update") {
      for (const row of fakeProjects.values()) if (matches(row)) Object.assign(row, payload);
      return { data: null, error: null };
    }
    if (op === "delete") {
      for (const [id, row] of fakeProjects) if (matches(row)) fakeProjects.delete(id);
      return { data: null, error: null };
    }
    let rows = [...fakeProjects.values()].filter(matches);
    if (orderCol) {
      const col = orderCol;
      rows = [...rows].sort((a, b) => {
        const diff = (a[col] as string) < (b[col] as string) ? -1 : 1;
        return orderAscending ? diff : -diff;
      });
    }
    return { data: rows, error: null };
  }

  const builder = {
    insert(row: Record<string, unknown>) {
      op = "insert";
      payload = row;
      return builder;
    },
    update(row: Record<string, unknown>) {
      op = "update";
      payload = row;
      return builder;
    },
    delete() {
      op = "delete";
      return builder;
    },
    select(_cols?: string) {
      if (!op) op = "select";
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push([col, val]);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col;
      orderAscending = opts?.ascending !== false;
      return builder;
    },
    async single() {
      const { data, error } = await exec();
      const row = Array.isArray(data) ? data[0] : data;
      return { data: row ?? null, error: error ?? (row ? null : new Error("not found")) };
    },
    async maybeSingle() {
      const { data, error } = await exec();
      const row = Array.isArray(data) ? data[0] : data;
      return { data: row ?? null, error };
    },
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      exec().then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.userId ? { id: authState.userId } : null } }),
    },
    from: () => makeQuery(),
  }),
}));

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
  // Node's test environment has no real `localStorage` — stubbed so the
  // `archsim:last-project-id` pointer (lib/store.ts) is actually testable,
  // not just silently no-op'd by its own try/catch.
  vi.stubGlobal("localStorage", fakeLocalStorage());
  fakeProjects.clear();
  nextId.current = 1;
  authState.userId = "test-user";
  authState.dbError = false;
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

  it("marks findings stale instead of refreshing them — costs no identifyFailures call", () => {
    useAppStore.setState({ model: degradedModel(), history: [] });

    useAppStore.getState().applyFix(fixedModel());

    expect(useAppStore.getState().findingsStale).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
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

  it("logs an AppliedFixRecord when one is passed, appended to appliedFixes", () => {
    useAppStore.setState({ model: degradedModel(), appliedFixes: [] });

    useAppStore.getState().applyFix(fixedModel(), {
      componentId: "svc",
      findingTitle: "Single instance",
      fixLabel: "Add a second instance",
      appliedAt: 123,
    });

    expect(useAppStore.getState().appliedFixes).toEqual([
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", appliedAt: 123 },
    ]);
  });

  it("leaves appliedFixes untouched when no record is passed (a chat-driven change)", () => {
    useAppStore.setState({ model: degradedModel(), appliedFixes: [] });

    useAppStore.getState().applyFix(fixedModel());

    expect(useAppStore.getState().appliedFixes).toEqual([]);
  });
});

describe("component detail modal", () => {
  it("openComponentDetail/closeComponentDetail toggle viewingComponent", () => {
    const component = degradedModel().components[0]!;
    useAppStore.setState({ viewingComponent: null });

    useAppStore.getState().openComponentDetail(component);
    expect(useAppStore.getState().viewingComponent).toBe(component);

    useAppStore.getState().closeComponentDetail();
    expect(useAppStore.getState().viewingComponent).toBeNull();
  });
});

function pendingFix(overrides: Partial<import("../lib/store").PendingFix> = {}) {
  return {
    componentId: "svc",
    findingCode: "SINGLE_POINT_OF_FAILURE",
    findingTitle: "Single instance",
    fixId: "add-instance",
    fixLabel: "Add a second instance",
    fixTradeoff: "More cost, no more single point of failure.",
    queuedAt: 1,
    ...overrides,
  };
}

describe("queueFix / unqueueFix", () => {
  it("queues a fix with no model change and no API call", () => {
    useAppStore.setState({ model: degradedModel(), pendingFixes: [], canResimulate: false });

    useAppStore.getState().queueFix(pendingFix());

    const state = useAppStore.getState();
    expect(state.pendingFixes).toHaveLength(1);
    expect(state.canResimulate).toBe(true);
    expect(state.model).toEqual(degradedModel()); // unchanged
    expect(fetch).not.toHaveBeenCalled();
  });

  it("replaces an existing queued fix for the same finding rather than adding a second one", () => {
    useAppStore.setState({ pendingFixes: [pendingFix({ fixId: "add-instance" })] });

    useAppStore.getState().queueFix(pendingFix({ fixId: "add-circuit-breaker", fixLabel: "Add a circuit breaker" }));

    const state = useAppStore.getState();
    expect(state.pendingFixes).toHaveLength(1);
    expect(state.pendingFixes[0]!.fixId).toBe("add-circuit-breaker");
  });

  it("queues separately for different findings", () => {
    useAppStore.setState({ pendingFixes: [] });

    useAppStore.getState().queueFix(pendingFix({ findingTitle: "Single instance" }));
    useAppStore.getState().queueFix(pendingFix({ findingTitle: "No circuit breaker", fixId: "add-circuit-breaker" }));

    expect(useAppStore.getState().pendingFixes).toHaveLength(2);
  });

  it("unqueueFix removes only the matching entry", () => {
    useAppStore.setState({
      pendingFixes: [pendingFix({ findingTitle: "A" }), pendingFix({ findingTitle: "B" })],
    });

    useAppStore.getState().unqueueFix("svc", "A");

    const state = useAppStore.getState();
    expect(state.pendingFixes).toHaveLength(1);
    expect(state.pendingFixes[0]!.findingTitle).toBe("B");
  });
});

describe("commitRework moves pendingFixes into appliedFixes", () => {
  it("on a successful Re-simulate, every queued fix becomes an applied one and the queue clears", async () => {
    useAppStore.setState({
      model: degradedModel(),
      history: [],
      appliedFixes: [],
      pendingFixes: [pendingFix()],
    });

    useAppStore.getState().commitRework(fixedModel());

    const state = useAppStore.getState();
    expect(state.pendingFixes).toHaveLength(0);
    expect(state.appliedFixes).toHaveLength(1);
    expect(state.appliedFixes[0]).toMatchObject({
      componentId: "svc",
      findingTitle: "Single instance",
      fixLabel: "Add a second instance",
    });
    expect(state.canResimulate).toBe(false);
    await vi.waitFor(() => expect(useAppStore.getState().findingsStatus).toBe("done"));
  });

  it("restoreVersion clears any queued fixes — they no longer refer to anything meaningful", async () => {
    useAppStore.setState({ model: degradedModel(), history: [], versions: [], pendingFixes: [pendingFix()] });
    useAppStore.getState().commitRework(fixedModel()); // records a version, clears queue from the fix above
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));
    const [version] = useAppStore.getState().versions;
    useAppStore.getState().queueFix(pendingFix({ findingTitle: "Another one" }));
    expect(useAppStore.getState().pendingFixes).toHaveLength(1);

    useAppStore.getState().restoreVersion(version!.id);

    expect(useAppStore.getState().pendingFixes).toHaveLength(0);
  });
});

describe("findingsStale", () => {
  it("set by setWorkloadTier and applyFix, only cleared by an actual refresh (commitRework)", async () => {
    const model: SystemModel = {
      ...checkout,
      workload: { ...checkout.workload, users: { included: true, tier: 100, target: 1_000_000 } },
    };
    useAppStore.setState({ model, history: [] });
    useAppStore.getState().setWorkloadTier("users", 10_000);
    expect(useAppStore.getState().findingsStale).toBe(true);

    // applyFix (a fix, or a chat-driven change) doesn't clear it either —
    // neither one spends an identifyFailures call on its own anymore.
    useAppStore.getState().applyFix(fixedModel());
    expect(useAppStore.getState().findingsStale).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    // Only an explicit Re-simulate (commitRework) actually refreshes
    // findings and clears the staleness once that fetch resolves.
    useAppStore.getState().commitRework(fixedModel());
    expect(useAppStore.getState().findingsStale).toBe(true); // still true until the fetch resolves

    await vi.waitFor(() => expect(useAppStore.getState().findingsStatus).toBe("done"));
    expect(useAppStore.getState().findingsStale).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/identify-failures",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("versions", () => {
  it("records a version on setModel (the initial build)", async () => {
    const model = degradedModel();

    useAppStore.getState().setModel(model);

    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));
    const [version] = useAppStore.getState().versions;
    expect(version!.model).toEqual(model);
    expect(version!.findings).toEqual([]);
  });

  it("records another version on commitRework (Re-simulate), not on undo or applyFix", async () => {
    useAppStore.setState({ model: degradedModel(), history: [], versions: [] });
    useAppStore.getState().setWorkloadTier("users", 10_000); // no version — not a resimulation
    useAppStore.getState().applyFix(fixedModel()); // no version either
    expect(useAppStore.getState().versions).toHaveLength(0);

    useAppStore.getState().commitRework(fixedModel());
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));

    useAppStore.getState().undo(); // reverting is not a resimulation either
    await vi.waitFor(() => expect(useAppStore.getState().findingsStatus).toBe("done"));
    expect(useAppStore.getState().versions).toHaveLength(1);
  });

  it("restoreVersion makes a past version live, preserves the full versions list, and pushes onto history", async () => {
    useAppStore.setState({ model: degradedModel(), history: [], versions: [] });
    useAppStore.getState().commitRework(fixedModel());
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));
    const v1 = useAppStore.getState().versions[0]!;

    const laterModel = degradedModel();
    useAppStore.setState({ model: laterModel, history: [] });

    useAppStore.getState().restoreVersion(v1.id);

    const state = useAppStore.getState();
    expect(state.model).toEqual(v1.model);
    expect(state.findings).toEqual(v1.findings);
    expect(state.canResimulate).toBe(false);
    expect(state.previewVersionId).toBeNull();
    expect(state.versions).toEqual([v1]); // restoring never shrinks the list
    expect(state.history).toEqual([laterModel]); // one Undo away
  });

  it("previewVersion just sets previewVersionId, mutating nothing else", () => {
    useAppStore.setState({ previewVersionId: null });

    useAppStore.getState().previewVersion("some-id");
    expect(useAppStore.getState().previewVersionId).toBe("some-id");

    useAppStore.getState().previewVersion(null);
    expect(useAppStore.getState().previewVersionId).toBeNull();
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
    expect(useAppStore.getState().findingsStale).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * `autosaveRevision` is what AutoSaveIndicator.tsx actually watches to
 * decide whether to (re)start its debounce timer — not `model` itself.
 * Moving the tier slider must NOT bump it (so it never triggers a save
 * or, via FlowDiagram.tsx's own separate `components`/`edges` dependency,
 * a canvas redraw), while every other model-changing action must.
 */
describe("autosaveRevision", () => {
  it("is not bumped by setWorkloadTier", () => {
    useAppStore.setState({ model: degradedModel(), autosaveRevision: 0 });

    useAppStore.getState().setWorkloadTier("users", 10_000);

    expect(useAppStore.getState().autosaveRevision).toBe(0);
  });

  it("is bumped by setModel, applyFix, queueFix, unqueueFix, commitRework, undo, and restoreVersion", async () => {
    useAppStore.setState({ model: degradedModel(), history: [], versions: [], pendingFixes: [], autosaveRevision: 0 });

    useAppStore.getState().setModel(fixedModel());
    expect(useAppStore.getState().autosaveRevision).toBe(1);

    useAppStore.getState().applyFix(fixedModel());
    expect(useAppStore.getState().autosaveRevision).toBe(2);

    useAppStore.getState().queueFix(pendingFix());
    expect(useAppStore.getState().autosaveRevision).toBe(3);

    useAppStore.getState().unqueueFix(pendingFix().componentId, pendingFix().findingTitle);
    expect(useAppStore.getState().autosaveRevision).toBe(4);

    useAppStore.getState().commitRework(fixedModel());
    expect(useAppStore.getState().autosaveRevision).toBe(5);
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));

    useAppStore.getState().undo();
    expect(useAppStore.getState().autosaveRevision).toBe(6);

    const version = useAppStore.getState().versions[0];
    if (!version) throw new Error("expected a recorded version");
    useAppStore.getState().restoreVersion(version.id);
    expect(useAppStore.getState().autosaveRevision).toBe(7);
  });
});

/**
 * Session state now lives in a fake in-memory `projects` table (see the
 * `vi.mock("../lib/supabase/client", ...)` above) keyed by project id, not
 * a single row per user — `sessionStorage.ts`'s own try/catch around a
 * missing user or a DB error is exercised directly via `authState`, and
 * the local "last opened project" pointer via a stubbed `localStorage`.
 */
describe("save/restore session", () => {
  it("saveToStorage then hydrateFromStorage round-trips the session, chat/fixes/versions included", async () => {
    const model = degradedModel();
    const chatMessages = [{ role: "user" as const, text: "why is this a single instance?" }];
    const appliedFixes = [
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", appliedAt: 1 },
    ];
    const versions = [{ id: "v1", model, findings: [], createdAt: 1 }];
    useAppStore.setState({
      model,
      history: [],
      findings: [],
      canResimulate: true,
      chatMessages,
      appliedFixes,
      versions,
    });

    await useAppStore.getState().saveToStorage();
    expect(useAppStore.getState().lastSavedAt).not.toBeNull();
    const projectId = useAppStore.getState().currentProjectId;
    expect(projectId).not.toBeNull();

    useAppStore.setState(initialState, true);
    expect(useAppStore.getState().model.components).toHaveLength(0);

    await useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().currentProjectId).toBe(projectId);
    expect(useAppStore.getState().model.id).toBe(model.id);
    expect(useAppStore.getState().canResimulate).toBe(true);
    expect(useAppStore.getState().chatMessages).toEqual(chatMessages);
    expect(useAppStore.getState().appliedFixes).toEqual(appliedFixes);
    expect(useAppStore.getState().versions).toEqual(versions);
  });

  it("hydrateFromStorage is a no-op when nothing was saved", async () => {
    await useAppStore.getState().hydrateFromStorage();

    expect(useAppStore.getState().model).toEqual(initialState.model);
  });

  it("degrades gracefully when logged out, and drops a stale pointer when the database errors", async () => {
    authState.userId = null;
    await expect(useAppStore.getState().saveToStorage()).resolves.toBe(false);
    expect(useAppStore.getState().lastSavedAt).toBeNull();

    authState.userId = "test-user";
    useAppStore.setState({ model: degradedModel() });
    await useAppStore.getState().saveToStorage();
    expect(useAppStore.getState().currentProjectId).not.toBeNull();

    // A pointer now exists (in localStorage) to a real saved project, but
    // the database is unreachable when hydrating it back.
    useAppStore.setState(initialState, true);
    authState.dbError = true;
    await expect(useAppStore.getState().hydrateFromStorage()).resolves.toBeUndefined();
    expect(useAppStore.getState().model.components).toHaveLength(0);
    expect(useAppStore.getState().hydrated).toBe(true);
  });
});

describe("multiple projects", () => {
  it("keeps separate projects separate across save, list, and open", async () => {
    useAppStore.setState({ model: degradedModel() });
    await useAppStore.getState().saveToStorage();
    const firstId = useAppStore.getState().currentProjectId!;

    useAppStore.getState().startNewProject();
    useAppStore.setState({ model: fixedModel() });
    await useAppStore.getState().saveToStorage();
    const secondId = useAppStore.getState().currentProjectId!;
    expect(secondId).not.toBe(firstId);

    await useAppStore.getState().refreshProjectList();
    const ids = useAppStore.getState().projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([firstId, secondId]));

    await useAppStore.getState().openProject(firstId);
    const svcAfterFirst = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svcAfterFirst?.kind !== "service") throw new Error("expected service");
    expect(svcAfterFirst.instanceCount.value).toBe("single");
    expect(useAppStore.getState().currentProjectId).toBe(firstId);

    await useAppStore.getState().openProject(secondId);
    const svcAfterSecond = useAppStore.getState().model.components.find((c) => c.id === "svc");
    if (svcAfterSecond?.kind !== "service") throw new Error("expected service");
    expect(svcAfterSecond.instanceCount.value).toBe("multiple");
  });

  it("deleteProjectById removes it from the list, and resets to blank if it was open", async () => {
    useAppStore.setState({ model: degradedModel() });
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;
    await useAppStore.getState().refreshProjectList();
    expect(useAppStore.getState().projects.map((p) => p.id)).toContain(id);

    await useAppStore.getState().deleteProjectById(id);

    expect(useAppStore.getState().projects.map((p) => p.id)).not.toContain(id);
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(useAppStore.getState().model.components).toHaveLength(0);
  });
});

describe("startNewProject", () => {
  it("resets the session to a blank canvas, chat/fixes/versions/modal included", () => {
    const component = degradedModel().components[0]!;
    useAppStore.setState({
      model: degradedModel(),
      history: [degradedModel()],
      canResimulate: true,
      chatMessages: [{ role: "user", text: "hi" }],
      appliedFixes: [{ componentId: "svc", findingTitle: "x", fixLabel: "y", appliedAt: 1 }],
      versions: [{ id: "v1", model: degradedModel(), findings: [], createdAt: 1 }],
      previewVersionId: "v1",
      viewingComponent: component,
    });

    useAppStore.getState().startNewProject();

    const state = useAppStore.getState();
    expect(state.model.components).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(state.canResimulate).toBe(false);
    expect(state.chatMessages).toHaveLength(0);
    expect(state.appliedFixes).toHaveLength(0);
    expect(state.versions).toHaveLength(0);
    expect(state.previewVersionId).toBeNull();
    expect(state.viewingComponent).toBeNull();
    expect(state.currentProjectId).toBeNull();
  });

  it("doesn't delete the previously saved project from the database — it just stops auto-resuming it", async () => {
    useAppStore.setState({ model: degradedModel(), history: [] });
    await useAppStore.getState().saveToStorage();
    const projectId = useAppStore.getState().currentProjectId!;

    useAppStore.getState().startNewProject();

    // Still there in storage...
    await useAppStore.getState().refreshProjectList();
    expect(useAppStore.getState().projects.map((p) => p.id)).toContain(projectId);

    // ...but a bare hydrate no longer auto-resumes it, since startNewProject
    // cleared the local "last opened" pointer on purpose.
    await useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().model.components).toHaveLength(0);

    // Explicitly reopening it still works.
    await useAppStore.getState().openProject(projectId);
    expect(useAppStore.getState().model.components.length).toBeGreaterThan(0);
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
      { role: "assistant", text: "Because it's a hot key.", changed: false },
    ]);
    expect(state.model).toBe(model);
    expect(state.canResimulate).toBe(false);
  });

  it("applies a change request exactly like a fix: commits the model, enables Re-simulate, no identifyFailures call", async () => {
    const model = degradedModel();
    const changed = fixedModel();
    useAppStore.setState({ model, chatMessages: [], history: [] });
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ isQuestion: false, reply: "Added a second instance.", model: changed })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useAppStore.getState().sendChatMessage("add another instance");

    const state = useAppStore.getState();
    expect(state.model).toEqual(changed);
    expect(state.canResimulate).toBe(true);
    expect(state.findingsStale).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.chatMessages.at(-1)).toEqual({
      role: "assistant",
      text: "Added a second instance.",
      changed: true,
    });
    // Only the chat call itself — applying the resulting change no longer
    // spends a second (identifyFailures) call on its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
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

  it("sends only the last 8 prior messages as history, not the full transcript", async () => {
    // 10 prior messages (5 exchanges) — more than the window.
    const priorMessages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `message ${i}`,
    }));
    useAppStore.setState({ model: degradedModel(), chatMessages: priorMessages });
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ isQuestion: true, reply: "ok" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useAppStore.getState().sendChatMessage("a new question");

    const [, requestInit] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse(requestInit!.body as string);
    expect(sentBody.history).toHaveLength(8);
    // The oldest 2 of the 10 prior messages (indices 0-1) should have
    // been dropped, keeping indices 2-9.
    expect(sentBody.history[0]).toEqual({ role: "user", content: "message 2" });
    expect(sentBody.history.at(-1)).toEqual({ role: "assistant", content: "message 9" });
  });
});
