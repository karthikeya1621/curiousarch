/**
 * useAppStore is a Zustand hook, but the hook itself exposes getState/
 * setState statically — no React rendering needed to exercise it.
 * `setModel`/`commitRework` trigger `refreshFindings`, which hits
 * /api/identify-failures — stubbed here via a mocked global `fetch`,
 * never a live call. Neither a tier move, a queued fix nor a queued chat
 * change refreshes them — each only marks Re-simulate available, to avoid
 * spending a live call on every change; only an explicit Re-simulate
 * (`commitRework`) actually refreshes them. Expected
 * model values are derived from the engine's own dormant reference
 * models, same standard as packages/engine's tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";
import type { SystemModel } from "@archsim/engine";
import { MAX_PENDING_CHANGES } from "../lib/limits";
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
      // Honors a caller-supplied id (a project's first save uses its draft id).
      const id = (payload?.id as string | undefined) ?? `project-${nextId.current++}`;
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
      getSession: async () => ({ data: { session: authState.userId ? { user: { id: authState.userId } } : null } }),
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
  // `archsim:last-project-id` pointer (lib/store/) is actually testable,
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

describe("commitRework", () => {
  it("clears the transient finding/fix/open-node selections — they pointed at the model being replaced", () => {
    useAppStore.setState({
      model: degradedModel(),
      selectedFindingId: "svc:SINGLE_POINT_OF_FAILURE",
      selectedFixId: "svc:add-instance",
      openComponentId: "svc",
    });

    useAppStore.getState().commitRework(fixedModel());

    const state = useAppStore.getState();
    expect(state.selectedFindingId).toBeNull();
    expect(state.selectedFixId).toBeNull();
    expect(state.openComponentId).toBeNull();
  });
});

/**
 * A project whose architecture differs from its last simulation. Nothing in
 * the app can produce that any more (fixes and chat changes both queue rather
 * than edit the model) — it survives only in a project saved back when chat
 * edited the model directly — so the tests that cover how such a project is
 * reported plant it by hand, exactly as loading one would leave the flags.
 */
function withUnsimulatedArchitecture(model: SystemModel) {
  useAppStore.setState({ model, chatChangeSinceResimulate: true, findingsStale: true, canResimulate: true });
}

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
    useAppStore.setState({ model: degradedModel(), versions: [], pendingFixes: [pendingFix()] });
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
  it("set by setWorkloadTier, unaffected by queueing a fix, only cleared by an actual refresh (commitRework)", async () => {
    const model: SystemModel = {
      ...checkout,
      workload: { ...checkout.workload, users: { included: true, tier: 100, target: 1_000_000 } },
    };
    useAppStore.setState({ model });
    useAppStore.getState().setWorkloadTier("users", 10_000);
    expect(useAppStore.getState().findingsStale).toBe(true);

    // Queueing a fix doesn't clear it either — and spends no
    // identifyFailures call on its own.
    useAppStore.getState().queueFix(pendingFix());
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

  it("records another version on commitRework (Re-simulate), not on a tier change, a queued fix, or revertParameters", async () => {
    useAppStore.setState({ model: degradedModel(), versions: [] });
    useAppStore.getState().setWorkloadTier("users", 10_000); // no version — not a resimulation
    useAppStore.getState().queueFix(pendingFix()); // no version either
    expect(useAppStore.getState().versions).toHaveLength(0);

    useAppStore.getState().commitRework(fixedModel());
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));

    const callsBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    useAppStore.getState().revertParameters(); // reverting is not a resimulation either
    await flush();
    expect(useAppStore.getState().versions).toHaveLength(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it("restoreVersion makes a past version live, makes it the baseline, and preserves the full versions list", async () => {
    useAppStore.setState({ model: degradedModel(), versions: [] });
    useAppStore.getState().commitRework(fixedModel());
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));
    const v1 = useAppStore.getState().versions[0]!;

    const laterModel = degradedModel();
    useAppStore.setState({ model: laterModel });

    useAppStore.getState().restoreVersion(v1.id);

    const state = useAppStore.getState();
    expect(state.model).toEqual(v1.model);
    expect(state.findings).toEqual(v1.findings);
    expect(state.canResimulate).toBe(false);
    expect(state.previewVersionId).toBeNull();
    expect(state.versions).toEqual([v1]); // restoring never shrinks the list
    expect(state.baselineModel).toEqual(v1.model);
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
    useAppStore.setState({ model, canResimulate: false });

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

  it("is bumped by setModel, queueFix, unqueueFix, commitRework, revertParameters, and restoreVersion", async () => {
    useAppStore.setState({ model: degradedModel(), versions: [], pendingFixes: [], autosaveRevision: 0 });
    // Each action must move the counter past wherever it was. Compared
    // relative to the previous value, not to fixed numbers: a Build or
    // Re-simulate's findings arriving later bumps it too (see "persisting
    // what a findings refresh produced"), which is asynchronous and would
    // otherwise make an absolute count depend on timing.
    let last = useAppStore.getState().autosaveRevision;
    const bumped = () => {
      const now = useAppStore.getState().autosaveRevision;
      expect(now).toBeGreaterThan(last);
      last = now;
    };

    useAppStore.getState().setModel(fixedModel());
    bumped();
    useAppStore.getState().queueFix(pendingFix());
    bumped();
    useAppStore.getState().unqueueFix(pendingFix().componentId, pendingFix().findingTitle);
    bumped();

    useAppStore.getState().commitRework(fixedModel());
    bumped();
    await vi.waitFor(() => expect(useAppStore.getState().versions.length).toBeGreaterThan(0));
    last = useAppStore.getState().autosaveRevision; // findings have landed; re-baseline

    useAppStore.getState().revertParameters();
    bumped();

    const version = useAppStore.getState().versions[0];
    if (!version) throw new Error("expected a recorded version");
    useAppStore.getState().restoreVersion(version.id);
    bumped();
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
      findings: [],
      // A queued fix is what makes Re-simulate available here — it's derived
      // from the data on load now, not restored from a saved flag.
      pendingFixes: [pendingFix()],
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
    await expect(useAppStore.getState().hydrateFromStorage()).resolves.toBe("not-found"); // nothing opened
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

describe("opening a project by id (the /project/<id> route)", () => {
  async function savedProject(model = degradedModel()) {
    useAppStore.setState({ model });
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;
    useAppStore.getState().startNewProject();
    return id;
  }

  it("openProject says whether it opened the project or couldn't find it", async () => {
    const id = await savedProject();
    expect(await useAppStore.getState().openProject(id)).toBe("opened");
    expect(useAppStore.getState().currentProjectId).toBe(id);

    expect(await useAppStore.getState().openProject("no-such-project")).toBe("not-found");
    expect(useAppStore.getState().currentProjectId).toBe(id); // a failed open leaves what's open alone
  });

  // The URL layer shows "Project not found" for `not-found` — so an open that
  // merely lost a race must never report it. Found by reasoning about a user
  // clicking another project while a /project/<id> load was in flight.
  it("an open overtaken by a newer one is `superseded`, not `not-found`, even if its own project doesn't exist", async () => {
    const real = await savedProject();
    const slow = useAppStore.getState().openProject("no-such-project");
    const fast = useAppStore.getState().openProject(real);

    expect(await fast).toBe("opened");
    expect(await slow).toBe("superseded");
    expect(useAppStore.getState().currentProjectId).toBe(real);
  });

  it("two real projects opened back to back: the later click wins, the earlier reports superseded", async () => {
    const first = await savedProject(degradedModel());
    const second = await savedProject(fixedModel());
    const a = useAppStore.getState().openProject(first);
    const b = useAppStore.getState().openProject(second);
    expect([await a, await b]).toEqual(["superseded", "opened"]);
    expect(useAppStore.getState().currentProjectId).toBe(second);
  });

  it("hydrateFromStorage(id) opens THAT project, ignoring the last-viewed pointer, and marks the store hydrated", async () => {
    const wanted = await savedProject(fixedModel());
    const other = await savedProject(degradedModel());
    localStorage.setItem("archsim:last-project-id", other); // the pointer names a different project

    const opened = await useAppStore.getState().hydrateFromStorage(wanted);

    expect(opened).toBe("opened");
    expect(useAppStore.getState().currentProjectId).toBe(wanted);
    expect(useAppStore.getState().hydrated).toBe(true);
    expect(localStorage.getItem("archsim:last-project-id")).toBe(wanted); // now what "last viewed" means
  });

  it("hydrateFromStorage(id) for a project that doesn't load: still hydrated, nothing opened, and the pointer is NOT dropped — one bad link says nothing about the last project", async () => {
    const last = await savedProject();
    localStorage.setItem("archsim:last-project-id", last);

    const opened = await useAppStore.getState().hydrateFromStorage("not-a-project");

    expect(opened).toBe("not-found");
    expect(useAppStore.getState().hydrated).toBe(true);
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(localStorage.getItem("archsim:last-project-id")).toBe(last);
  });

  it("hydrateFromStorage() with no id still resumes the last project", async () => {
    const id = await savedProject();
    localStorage.setItem("archsim:last-project-id", id);
    expect(await useAppStore.getState().hydrateFromStorage()).toBe("opened");
    expect(useAppStore.getState().currentProjectId).toBe(id);
  });

  it("hydrateFromStorage() with no pointer finds nothing and is hydrated (a blank first visit)", async () => {
    localStorage.removeItem("archsim:last-project-id");
    expect(await useAppStore.getState().hydrateFromStorage()).toBe("not-found");
    expect(useAppStore.getState().hydrated).toBe(true);
  });
});

describe("saveBeforeLeaving (leaving a project without a confirmation)", () => {
  // How many times the fake database has been written to — the thing a
  // needless save would inflate (and would bump a project's "updated" time).
  const writes = () => {
    let count = 0;
    for (const row of fakeProjects.values()) count += (row as { data?: { savedAt?: number } }).data?.savedAt ? 1 : 0;
    return count;
  };
  const savedAtOf = (id: string) => ((fakeProjects.get(id) as { data: { savedAt: number } }).data.savedAt);

  async function openSavedProject() {
    useAppStore.setState({ model: modelWithUsers() });
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;
    useAppStore.getState().startNewProject();
    // Some activity in the session before this project is opened, so the
    // revision counter isn't sitting at its initial 0 — a load must mark what
    // it loaded as saved at THIS revision, not rely on both starting equal.
    useAppStore.setState({ autosaveRevision: 7 });
    await useAppStore.getState().openProject(id);
    return id;
  }

  it("is a no-op on a blank canvas — there's nothing to lose", async () => {
    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);
    expect(writes()).toBe(0);
  });

  it("doesn't save a project that's unchanged since it was loaded — so browsing doesn't bump its updated time", async () => {
    const id = await openSavedProject();
    const before = savedAtOf(id);
    await new Promise((r) => setTimeout(r, 5)); // a save would produce a later timestamp

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);

    expect(savedAtOf(id)).toBe(before);
  });

  it("saves a change the debounced autosave hasn't written yet, then says it's safe to go", async () => {
    const id = await openSavedProject();
    const before = savedAtOf(id);
    await new Promise((r) => setTimeout(r, 5));
    useAppStore.getState().queueFix(pendingFix()); // bumps the revision; autosave hasn't fired

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);

    expect(savedAtOf(id)).toBeGreaterThan(before);
    const row = fakeProjects.get(id) as { data: { pendingFixes: unknown[] } };
    expect(row.data.pendingFixes).toHaveLength(1);
  });

  it("saves a moved tier too — autosave deliberately never does, but leaving would lose it", async () => {
    const id = await openSavedProject();
    useAppStore.setState({ baselineModel: modelWithUsers() });
    useAppStore.getState().setWorkloadTier("users", 10_000);

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);

    const row = fakeProjects.get(id) as { data: { model: SystemModel } };
    expect(row.data.model.workload.users?.tier).toBe(10_000);
  });

  it("saves a project that was built but never saved, giving it its id", async () => {
    useAppStore.setState({ model: modelWithUsers(), autosaveRevision: 1 });
    expect(useAppStore.getState().currentProjectId).toBeNull();

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);

    expect(useAppStore.getState().currentProjectId).not.toBeNull();
    expect(writes()).toBe(1);
  });

  it("says NO — the one case worth interrupting for — when a needed save fails", async () => {
    await openSavedProject();
    useAppStore.getState().queueFix(pendingFix());
    authState.dbError = true;

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(false);
  });

  it("a successful save marks the project clean, so leaving twice saves once", async () => {
    const id = await openSavedProject();
    useAppStore.getState().queueFix(pendingFix());
    await useAppStore.getState().saveBeforeLeaving();
    const after = savedAtOf(id);
    await new Promise((r) => setTimeout(r, 5));

    expect(await useAppStore.getState().saveBeforeLeaving()).toBe(true);
    expect(savedAtOf(id)).toBe(after);
  });

  it("a change made WHILE a save is in flight still counts as unsaved", async () => {
    await openSavedProject();
    const saving = useAppStore.getState().saveToStorage();
    useAppStore.getState().queueFix(pendingFix()); // bumps the revision after the save captured its own
    await saving;

    expect(useAppStore.getState().autosaveRevision).not.toBe(useAppStore.getState().savedRevision);
  });
});

describe("startNewProject", () => {
  it("resets the session to a blank canvas, chat/fixes/versions/modal included", () => {
    const component = degradedModel().components[0]!;
    useAppStore.setState({
      model: degradedModel(),
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
    expect(state.canResimulate).toBe(false);
    expect(state.chatMessages).toHaveLength(0);
    expect(state.appliedFixes).toHaveLength(0);
    expect(state.versions).toHaveLength(0);
    expect(state.previewVersionId).toBeNull();
    expect(state.viewingComponent).toBeNull();
    expect(state.currentProjectId).toBeNull();
  });

  it("doesn't delete the previously saved project from the database — it just stops auto-resuming it", async () => {
    useAppStore.setState({ model: degradedModel() });
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
      { role: "assistant", text: "Because it's a hot key." },
    ]);
    expect(state.model).toBe(model);
    expect(state.canResimulate).toBe(false);
  });

  it("QUEUES a change request instead of applying it: the model stays as it is, Re-simulate turns on, no other call", async () => {
    const model = degradedModel();
    useAppStore.setState({ model, chatMessages: [] });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          isQuestion: false,
          reply: "Adding a second instance.",
          instruction: 'Set the order service "svc" to multiple instances.',
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useAppStore.getState().sendChatMessage("add another instance");

    const state = useAppStore.getState();
    expect(state.model).toBe(model); // untouched until Re-simulate
    expect(state.canResimulate).toBe(true);
    expect(state.findingsStale).toBe(false); // the model didn't change, so the findings still describe it
    expect(state.chatChangeSinceResimulate).toBe(false);
    expect(state.pendingChanges).toEqual([
      {
        id: expect.any(String),
        request: "add another instance", // the user's exact words…
        instruction: 'Set the order service "svc" to multiple instances.', // …and the self-contained restatement
        queuedAt: expect.any(Number),
      },
    ]);
    expect(state.chatMessages.at(-1)).toEqual({
      role: "assistant",
      text: "Adding a second instance.",
      change: { id: state.pendingChanges[0]!.id, status: "queued" },
    });
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

/** A promise whose resolution the test controls — for asserting what happens to a response that arrives late. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const someFinding = (title: string) => ({
  code: "SINGLE_POINT_OF_FAILURE",
  severity: "critical" as const,
  componentId: "svc",
  title,
  explanation: "…",
  fixes: [],
});

function modelWithUsers(): SystemModel {
  return {
    ...degradedModel(),
    workload: { users: { included: true, tier: 100, target: 1_000_000 } },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("async responses that arrive after the project changed", () => {
  it("drops a chat reply that lands after the project was switched, instead of applying it to the new one", async () => {
    useAppStore.setState({ model: degradedModel(), chatMessages: [] });
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));

    const pending = useAppStore.getState().sendChatMessage("add another instance");
    useAppStore.getState().startNewProject();
    gate.resolve(jsonResponse({ isQuestion: false, reply: "Added.", instruction: "Add an instance." }));
    await pending;

    const state = useAppStore.getState();
    expect(state.model.components).toEqual([]);
    expect(state.chatMessages).toEqual([]);
    expect(state.pendingChanges).toEqual([]);
    expect(state.canResimulate).toBe(false);
  });

  it("drops a findings response (and its version snapshot) that lands after the project was switched", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));

    useAppStore.getState().setModel(degradedModel());
    useAppStore.getState().startNewProject();
    gate.resolve(jsonResponse({ findings: [someFinding("Leaked from the old project")] }));
    await flush();

    const state = useAppStore.getState();
    expect(state.findings).toEqual([]);
    expect(state.versions).toEqual([]);
    expect(state.findingsStatus).toBe("idle");
  });

  it("lets only the most recent findings refresh update what's shown, but still records a superseded Re-simulate's version", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    useAppStore.setState({ model: degradedModel(), versions: [] });

    useAppStore.getState().commitRework(fixedModel()); // request 1
    useAppStore.getState().commitRework(degradedModel()); // request 2 — the latest
    second.resolve(jsonResponse({ findings: [someFinding("newer")] }));
    await vi.waitFor(() => expect(useAppStore.getState().findings).toEqual([someFinding("newer")]));

    first.resolve(jsonResponse({ findings: [someFinding("older")] }));
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(2)); // both snapshots kept
    expect(useAppStore.getState().findings).toEqual([someFinding("newer")]); // but only the latest is shown
  });

  it("still queues a chat change when a tier moved while the AI was working — nothing to overwrite, so nothing withheld", async () => {
    useAppStore.setState({ model: modelWithUsers(), baselineModel: modelWithUsers(), chatMessages: [] });
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));

    const pending = useAppStore.getState().sendChatMessage("add another instance");
    useAppStore.getState().setWorkloadTier("users", 10_000);
    gate.resolve(jsonResponse({ isQuestion: false, reply: "Added.", instruction: "Add an instance." }));
    await pending;

    const state = useAppStore.getState();
    expect(state.model.workload.users?.tier).toBe(10_000); // the tier edit is intact
    expect(state.pendingChanges).toHaveLength(1); // and so is the request
    expect(state.chatMessages.at(-1)!.change?.status).toBe("queued");
    expect(state.parametersChangedSinceResimulate).toBe(true);
  });
});

describe("change-source flags (what the 'Updates since last Re-simulate' box reports)", () => {
  it("setWorkloadTier flags a parameter change, and only that", () => {
    useAppStore.setState({ model: modelWithUsers() });
    useAppStore.getState().setWorkloadTier("users", 10_000);
    const state = useAppStore.getState();
    expect(state.parametersChangedSinceResimulate).toBe(true);
    expect(state.chatChangeSinceResimulate).toBe(false);
  });

  it("both flags can be true at once, and both clear on commitRework, restoreVersion, and a fresh build", async () => {
    const reset = () => {
      const s = useAppStore.getState();
      expect(s.parametersChangedSinceResimulate).toBe(false);
      expect(s.chatChangeSinceResimulate).toBe(false);
    };
    const raiseBoth = () => {
      useAppStore.setState({ model: modelWithUsers(), baselineModel: modelWithUsers() });
      useAppStore.getState().setWorkloadTier("users", 10_000);
      // The architecture differs too, workload carried forward — only the
      // architecture is new.
      withUnsimulatedArchitecture({ ...fixedModel(), workload: useAppStore.getState().model.workload });
      const s = useAppStore.getState();
      expect(s.parametersChangedSinceResimulate).toBe(true);
      expect(s.chatChangeSinceResimulate).toBe(true);
    };

    raiseBoth();
    useAppStore.getState().commitRework(fixedModel());
    reset();

    raiseBoth();
    useAppStore.setState({ versions: [{ id: "v1", model: degradedModel(), findings: [], createdAt: 1 }] });
    useAppStore.getState().restoreVersion("v1");
    reset();

    raiseBoth();
    useAppStore.getState().setModel(degradedModel());
    reset();
    await flush();
  });

  it("are persisted with the session, and default to false for one saved before they existed", async () => {
    useAppStore.setState({ model: modelWithUsers() });
    useAppStore.getState().setWorkloadTier("users", 10_000);
    withUnsimulatedArchitecture(fixedModel());
    await useAppStore.getState().saveToStorage();

    useAppStore.getState().startNewProject();
    await useAppStore.getState().hydrateFromStorage();
    // startNewProject cleared the pointer — reopen explicitly.
    const id = [...fakeProjects.keys()][0]!;
    await useAppStore.getState().openProject(id);
    expect(useAppStore.getState().parametersChangedSinceResimulate).toBe(true);
    expect(useAppStore.getState().chatChangeSinceResimulate).toBe(true);

    // A row saved before these fields existed.
    const row = fakeProjects.get(id)! as { data: Record<string, unknown> };
    delete row.data.parametersChangedSinceResimulate;
    delete row.data.chatChangeSinceResimulate;
    await useAppStore.getState().openProject(id);
    expect(useAppStore.getState().parametersChangedSinceResimulate).toBe(false);
    expect(useAppStore.getState().chatChangeSinceResimulate).toBe(false);
  });
});

describe("persisting what a findings refresh produced", () => {
  it("bumps autosaveRevision when findings arrive, so they (and the version they record) actually get saved", async () => {
    // The autosave in AutoSaveIndicator.tsx only fires on `autosaveRevision`.
    // Build/Re-simulate bump it when they START, i.e. while findings are
    // still loading — so without a bump on arrival, the row is saved with
    // the OLD findings (and, after a Re-simulate, `findingsStale` still
    // true) and never corrected. Reopening then shows "Based on the
    // previous version…" for a project that was in fact just re-simulated.
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));

    useAppStore.getState().setModel(degradedModel());
    const revisionWhileLoading = useAppStore.getState().autosaveRevision;
    gate.resolve(jsonResponse({ findings: [someFinding("arrived")] }));
    await vi.waitFor(() => expect(useAppStore.getState().findings).toHaveLength(1));

    expect(useAppStore.getState().autosaveRevision).toBeGreaterThan(revisionWhileLoading);
  });
});

describe("reverting a change clears what's pending (derived from the baseline, not latched)", () => {
  /** A built project whose findings match its model — the state right after a Build/Re-simulate. */
  function builtProject() {
    const model = modelWithUsers();
    useAppStore.setState({ model, baselineModel: model, canResimulate: false, findingsStale: false });
    return model;
  }
  const pendingFlags = () => {
    const s = useAppStore.getState();
    return {
      params: s.parametersChangedSinceResimulate,
      chat: s.chatChangeSinceResimulate,
      canResimulate: s.canResimulate,
      stale: s.findingsStale,
    };
  };

  it("moving a tier back to where it started clears the pending state entirely", () => {
    builtProject();
    useAppStore.getState().setWorkloadTier("users", 10_000);
    expect(pendingFlags()).toEqual({ params: true, chat: false, canResimulate: true, stale: true });

    useAppStore.getState().setWorkloadTier("users", 100);
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
  });

  it("Reset puts the controls back to the last simulation's values, clears the pending state, and calls no API", async () => {
    builtProject();
    useAppStore.getState().setWorkloadTier("users", 10_000);
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    useAppStore.getState().revertParameters();
    await flush();

    expect(useAppStore.getState().model.workload.users?.tier).toBe(100);
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls); // no findings refresh, no version
    expect(useAppStore.getState().versions).toEqual([]);
  });

  it("Reset without a baseline (a legacy project with pending changes) does nothing", () => {
    useAppStore.setState({ model: modelWithUsers(), baselineModel: null, autosaveRevision: 0 });
    useAppStore.getState().setWorkloadTier("users", 10_000);
    useAppStore.getState().revertParameters();
    expect(useAppStore.getState().model.workload.users?.tier).toBe(10_000);
    expect(useAppStore.getState().autosaveRevision).toBe(0);
  });

  it("moving a control persists (bumps autosave) only when it lands back on the baseline, not on the way out", () => {
    builtProject();
    const start = useAppStore.getState().autosaveRevision;
    useAppStore.getState().setWorkloadTier("users", 10_000); // away: a parameter change is reviewed, not saved
    expect(useAppStore.getState().autosaveRevision).toBe(start);
    useAppStore.getState().setWorkloadTier("users", 100); // back: clear whatever a piggybacked save persisted
    expect(useAppStore.getState().autosaveRevision).toBe(start + 1);
  });

  it("reverting a parameter keeps Re-simulate available if a fix is still queued — but the findings aren't stale", () => {
    builtProject();
    useAppStore.getState().queueFix(pendingFix());
    useAppStore.getState().setWorkloadTier("users", 10_000);
    useAppStore.getState().setWorkloadTier("users", 100);
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: true, stale: false });
  });

  it("removing the only queued fix disables Re-simulate, but not while something else is still pending", () => {
    builtProject();
    useAppStore.getState().queueFix(pendingFix());
    useAppStore.getState().unqueueFix("svc", "Single instance");
    expect(useAppStore.getState().canResimulate).toBe(false);

    useAppStore.getState().queueFix(pendingFix());
    useAppStore.getState().setWorkloadTier("users", 10_000);
    useAppStore.getState().unqueueFix("svc", "Single instance");
    expect(useAppStore.getState().canResimulate).toBe(true); // the tier change still warrants it
  });

  it("Reset reverts the controls only: an unsimulated architecture change and a queued fix made alongside stay pending", () => {
    builtProject();
    useAppStore.getState().setWorkloadTier("users", 10_000);
    withUnsimulatedArchitecture({ ...fixedModel(), workload: useAppStore.getState().model.workload });
    useAppStore.getState().queueFix(pendingFix());
    expect(pendingFlags()).toMatchObject({ params: true, chat: true });

    useAppStore.getState().revertParameters();

    expect(pendingFlags()).toEqual({ params: false, chat: true, canResimulate: true, stale: true });
    expect(useAppStore.getState().model.workload.users?.tier).toBe(100);
    expect(useAppStore.getState().model.components).toEqual(fixedModel().components); // chat change kept
    expect(useAppStore.getState().pendingFixes).toHaveLength(1);
  });

  it("re-baselines when findings land: a tier moved WHILE they were loading is still pending afterwards", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    useAppStore.getState().setModel(modelWithUsers());

    useAppStore.getState().setWorkloadTier("users", 10_000); // moved during the flight
    gate.resolve(jsonResponse({ findings: [someFinding("for the model as built")] }));
    await vi.waitFor(() => expect(useAppStore.getState().findings).toHaveLength(1));

    // The findings describe the model AS BUILT, so the moved tier is pending.
    // (Previously this blanket-cleared "stale", wrongly hiding the caption.)
    expect(pendingFlags()).toEqual({ params: true, chat: false, canResimulate: true, stale: true });
  });

  it("the baseline is saved with the project, so reverting still works after a reload", async () => {
    builtProject();
    useAppStore.getState().setWorkloadTier("users", 10_000);
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;

    useAppStore.getState().startNewProject();
    await useAppStore.getState().openProject(id);
    expect(pendingFlags()).toMatchObject({ params: true, canResimulate: true });

    useAppStore.getState().setWorkloadTier("users", 100);
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
  });

  it("an older project saved without a baseline: clean ones adopt their model as the baseline; pending ones keep latching until re-simulated", async () => {
    // Clean: nothing pending when saved → current model is the baseline.
    useAppStore.setState({ model: modelWithUsers(), baselineModel: null });
    await useAppStore.getState().saveToStorage();
    const cleanId = useAppStore.getState().currentProjectId!;
    (fakeProjects.get(cleanId) as { data: Record<string, unknown> }).data.baselineModel = undefined;
    delete (fakeProjects.get(cleanId) as { data: Record<string, unknown> }).data.baselineModel;
    await useAppStore.getState().openProject(cleanId);
    expect(useAppStore.getState().baselineModel).toEqual(modelWithUsers());

    // Pending: baseline unknowable → null, so a tier move latches on as before.
    useAppStore.getState().startNewProject();
    useAppStore.setState({ model: modelWithUsers(), baselineModel: null, canResimulate: true, findingsStale: true });
    await useAppStore.getState().saveToStorage();
    const pendingId = useAppStore.getState().currentProjectId!;
    delete (fakeProjects.get(pendingId) as { data: Record<string, unknown> }).data.baselineModel;
    await useAppStore.getState().openProject(pendingId);
    expect(useAppStore.getState().baselineModel).toBeNull();
    useAppStore.getState().setWorkloadTier("users", 10_000);
    expect(pendingFlags()).toMatchObject({ params: true, canResimulate: true });
  });

  // An older project saved with a latched "Parameters changed" but no baseline:
  // Reset was disabled (nothing to revert to) while the notes still listed it.
  // Its newest version IS the last simulation's model, so the baseline is
  // recovered from that and the flags are re-derived from the data on load.
  function saveLegacy(opts: { model: SystemModel; versionModel: SystemModel; keepNullBaseline?: boolean }) {
    useAppStore.setState({
      model: opts.model,
      baselineModel: null,
      canResimulate: true,
      findingsStale: true,
      parametersChangedSinceResimulate: true, // the latched flag an older save carries
      versions: [{ id: "v1", model: opts.versionModel, findings: [], createdAt: 1 }],
    });
    return useAppStore.getState().saveToStorage().then(() => {
      const id = useAppStore.getState().currentProjectId!;
      // Either absent (saved before baselines existed) or an explicit null
      // (saved by a build that had none, e.g. reopened-then-autosaved).
      if (!opts.keepNullBaseline) delete (fakeProjects.get(id) as { data: Record<string, unknown> }).data.baselineModel;
      useAppStore.getState().startNewProject();
      return id;
    });
  }

  it("a legacy project whose controls were already put back loads with nothing pending (recovered from its last version)", async () => {
    const id = await saveLegacy({ model: modelWithUsers(), versionModel: modelWithUsers() });
    await useAppStore.getState().openProject(id);

    expect(useAppStore.getState().baselineModel).toEqual(modelWithUsers());
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
  });

  it("a project saved with an explicit null baseline recovers it the same way (it used to stay null forever)", async () => {
    const id = await saveLegacy({ model: modelWithUsers(), versionModel: modelWithUsers(), keepNullBaseline: true });
    expect((fakeProjects.get(id) as { data: Record<string, unknown> }).data.baselineModel).toBeNull();
    await useAppStore.getState().openProject(id);

    expect(useAppStore.getState().baselineModel).toEqual(modelWithUsers());
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
  });

  it("a legacy project whose tier really differs from its last simulation shows the change, and Reset can undo it", async () => {
    const moved = modelWithUsers();
    moved.workload = { users: { included: true, tier: 10_000, target: 1_000_000 } };
    const id = await saveLegacy({ model: moved, versionModel: modelWithUsers() });
    await useAppStore.getState().openProject(id);

    expect(pendingFlags()).toMatchObject({ params: true, canResimulate: true });
    useAppStore.getState().revertParameters();
    expect(useAppStore.getState().model.workload.users?.tier).toBe(100);
    expect(pendingFlags()).toEqual({ params: false, chat: false, canResimulate: false, stale: false });
  });
});

describe("queued chat changes", () => {
  const changeReply = (n = 1) =>
    jsonResponse({ isQuestion: false, reply: `Queued ${n}.`, instruction: `Instruction ${n}.` });
  const stubChat = (...responses: Response[]) => {
    const fetchMock = vi.fn();
    for (const r of responses) fetchMock.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const builtProject = () => {
    const model = modelWithUsers();
    useAppStore.setState({ model, baselineModel: model, chatMessages: [], canResimulate: false, findingsStale: false });
    return model;
  };
  const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
    JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

  it("sends the whole queue with every later message, so a follow-up builds on it — including past the history window", async () => {
    builtProject();
    const fetchMock = stubChat(changeReply(1), changeReply(2), jsonResponse({ isQuestion: true, reply: "ok" }));

    await useAppStore.getState().sendChatMessage("add a CDN");
    await useAppStore.getState().sendChatMessage("put a cache behind it");
    // Enough filler to push both requests out of the 8-message history window.
    useAppStore.setState((st) => ({
      chatMessages: [
        ...st.chatMessages,
        ...Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, text: `filler ${i}` })),
      ],
    }));
    await useAppStore.getState().sendChatMessage("what's queued?");

    expect(sentBody(fetchMock, 0).pendingChanges).toEqual([]);
    expect(sentBody(fetchMock, 1).pendingChanges).toHaveLength(1);
    const third = sentBody(fetchMock, 2);
    expect(third.history.some((m: { content: string }) => m.content === "add a CDN")).toBe(false); // out of the window…
    expect(third.pendingChanges.map((c: { request: string; instruction: string }) => [c.request, c.instruction])).toEqual([
      ["add a CDN", "Instruction 1."], // …but still fully known, verbatim and restated
      ["put a cache behind it", "Instruction 2."],
    ]);
  });

  it("a plain question queues nothing and leaves Re-simulate off", async () => {
    builtProject();
    stubChat(jsonResponse({ isQuestion: true, reply: "Because." }));
    await useAppStore.getState().sendChatMessage("why?");
    expect(useAppStore.getState().pendingChanges).toEqual([]);
    expect(useAppStore.getState().canResimulate).toBe(false);
  });

  it("removing a queued change takes it out, marks its chat message removed, and turns Re-simulate off if nothing else is pending", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    const id = useAppStore.getState().pendingChanges[0]!.id;
    const revision = useAppStore.getState().autosaveRevision;

    useAppStore.getState().unqueueChatChange(id);

    const state = useAppStore.getState();
    expect(state.pendingChanges).toEqual([]);
    expect(state.canResimulate).toBe(false);
    expect(state.chatMessages.at(-1)!.change).toEqual({ id, status: "removed" });
    expect(state.autosaveRevision).toBe(revision + 1);
  });

  it("removing one leaves Re-simulate on while another change, a fix or a parameter change is still pending", async () => {
    builtProject();
    stubChat(changeReply(1), changeReply(2));
    await useAppStore.getState().sendChatMessage("one");
    await useAppStore.getState().sendChatMessage("two");
    const [first, second] = useAppStore.getState().pendingChanges;

    useAppStore.getState().unqueueChatChange(first!.id);
    expect(useAppStore.getState().canResimulate).toBe(true); // "two" still waiting
    expect(useAppStore.getState().chatMessages.filter((m) => m.change?.status === "queued")).toHaveLength(1);

    useAppStore.getState().queueFix(pendingFix());
    useAppStore.getState().unqueueChatChange(second!.id);
    expect(useAppStore.getState().canResimulate).toBe(true); // the queued fix still warrants it
  });

  it("removing an id that isn't queued does nothing", () => {
    builtProject();
    const revision = useAppStore.getState().autosaveRevision;
    useAppStore.getState().unqueueChatChange("nope");
    expect(useAppStore.getState().autosaveRevision).toBe(revision);
  });

  it("Reset (revert parameters) leaves a queued chat change, and Re-simulate, in place", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    useAppStore.getState().setWorkloadTier("users", 10_000);

    useAppStore.getState().revertParameters();

    expect(useAppStore.getState().parametersChangedSinceResimulate).toBe(false);
    expect(useAppStore.getState().pendingChanges).toHaveLength(1);
    expect(useAppStore.getState().canResimulate).toBe(true);
  });

  it("reverting a parameter with a chat change queued keeps Re-simulate on (derived, not latched)", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    useAppStore.getState().setWorkloadTier("users", 10_000);
    useAppStore.getState().setWorkloadTier("users", 100);
    expect(useAppStore.getState().canResimulate).toBe(true);
    expect(useAppStore.getState().findingsStale).toBe(false);
  });

  it("commitRework (Re-simulate) clears the queue and flips its chat messages to applied", async () => {
    builtProject();
    stubChat(changeReply(1), jsonResponse({ isQuestion: true, reply: "just an answer" }));
    await useAppStore.getState().sendChatMessage("add a CDN");
    await useAppStore.getState().sendChatMessage("why?");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ findings: [] }))));

    useAppStore.getState().commitRework(fixedModel());
    await flush();

    const state = useAppStore.getState();
    expect(state.pendingChanges).toEqual([]);
    expect(state.chatMessages.filter((m) => m.change).map((m) => m.change!.status)).toEqual(["applied"]);
    expect(state.canResimulate).toBe(false);
  });

  it("commitRework leaves an already-removed change marked removed, not applied", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    useAppStore.getState().unqueueChatChange(useAppStore.getState().pendingChanges[0]!.id);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ findings: [] }))));

    useAppStore.getState().commitRework(fixedModel());
    await flush();

    expect(useAppStore.getState().chatMessages.at(-1)!.change!.status).toBe("removed");
  });

  it("restoring a version discards the queue and marks its chat messages removed", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    useAppStore.setState({ versions: [{ id: "v1", model: degradedModel(), findings: [], createdAt: 1 }] });

    useAppStore.getState().restoreVersion("v1");

    const state = useAppStore.getState();
    expect(state.pendingChanges).toEqual([]);
    expect(state.chatMessages.at(-1)!.change!.status).toBe("removed");
    expect(state.canResimulate).toBe(false);
  });

  it("refuses to queue past MAX_PENDING_CHANGES, and says so in the reply instead of dropping it silently", async () => {
    builtProject();
    useAppStore.setState({
      pendingChanges: Array.from({ length: MAX_PENDING_CHANGES }, (_, i) => ({
        id: `c${i}`,
        request: `r${i}`,
        instruction: `i${i}`,
        queuedAt: i,
      })),
    });
    stubChat(changeReply(99));

    await useAppStore.getState().sendChatMessage("one more");

    const state = useAppStore.getState();
    expect(state.pendingChanges).toHaveLength(MAX_PENDING_CHANGES);
    const last = state.chatMessages.at(-1)!;
    expect(last.change).toBeUndefined();
    expect(last.text).toMatch(/Not queued/);
  });

  it("is persisted with the project: a reload keeps the queue, its chat status, and Re-simulate", async () => {
    builtProject();
    stubChat(changeReply(1));
    await useAppStore.getState().sendChatMessage("add a CDN");
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;
    const queued = useAppStore.getState().pendingChanges;

    useAppStore.getState().startNewProject();
    expect(useAppStore.getState().pendingChanges).toEqual([]); // a new project starts clean
    await useAppStore.getState().openProject(id);

    const state = useAppStore.getState();
    expect(state.pendingChanges).toEqual(queued);
    expect(state.chatMessages.at(-1)!.change).toEqual({ id: queued[0]!.id, status: "queued" });
    expect(state.canResimulate).toBe(true);
    expect(state.findingsStale).toBe(false);
  });

  it("a project saved before chat changes were queued loads with an empty queue", async () => {
    builtProject();
    await useAppStore.getState().saveToStorage();
    const id = useAppStore.getState().currentProjectId!;
    delete (fakeProjects.get(id) as { data: Record<string, unknown> }).data.pendingChanges;

    useAppStore.getState().startNewProject();
    await useAppStore.getState().openProject(id);

    expect(useAppStore.getState().pendingChanges).toEqual([]);
  });
});

describe("AI usage tracking (client side)", () => {
  const ACTION = "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21";
  const OTHER = "0a9f0d7e-2b1a-4c1e-9a55-0d3f5b7a1e99";
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

  /** Routes by URL: findings/chat go to the given handlers, the outcome report always succeeds. */
  function stubRoutes(handlers: { findings?: () => Promise<Response>; chat?: () => Promise<Response> }) {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/usage/outcome") return Promise.resolve(new Response(null, { status: 204 }));
      if (url === "/api/identify-failures") return (handlers.findings ?? (() => Promise.resolve(jsonResponse({ findings: [] }))))();
      if (url === "/api/chat") return (handlers.chat ?? (() => Promise.resolve(jsonResponse({ isQuestion: true, reply: "ok" }))))();
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const outcomes = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter((c) => c[0] === "/api/usage/outcome").map((c) => bodyOf(c));

  it("labels the findings call with the build's action id and the project id it will be saved under, and stamps the version with that action", async () => {
    const fetchMock = stubRoutes({});
    const draft = useAppStore.getState().draftProjectId;

    useAppStore.getState().setModel(degradedModel(), ACTION);
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));

    const sent = bodyOf(fetchMock.mock.calls[0]!);
    expect(sent).toMatchObject({ actionId: ACTION, projectId: draft });
    expect(useAppStore.getState().versions[0]!.actionId).toBe(ACTION);
    expect(outcomes(fetchMock)).toEqual([]); // nothing was wasted
  });

  it("mints an action id when the caller has none, so a bare refresh is still tracked", async () => {
    const fetchMock = stubRoutes({});
    useAppStore.getState().setModel(degradedModel());
    await vi.waitFor(() => expect(useAppStore.getState().versions).toHaveLength(1));
    expect(bodyOf(fetchMock.mock.calls[0]!).actionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a project's first save uses the draft id it was already tracked under, and every later call uses that same id", async () => {
    const draft = useAppStore.getState().draftProjectId;
    useAppStore.setState({ model: modelWithUsers(), baselineModel: modelWithUsers() });

    await useAppStore.getState().saveToStorage();

    expect(useAppStore.getState().currentProjectId).toBe(draft);
    expect(fakeProjects.has(draft)).toBe(true);
    const fetchMock = stubRoutes({});
    useAppStore.getState().commitRework(fixedModel(), OTHER);
    await flush();
    expect(bodyOf(fetchMock.mock.calls[0]!).projectId).toBe(draft);
  });

  it("starting a new project mints a fresh draft id, so its usage isn't filed under the old one", () => {
    const before = useAppStore.getState().draftProjectId;
    useAppStore.getState().startNewProject();
    expect(useAppStore.getState().draftProjectId).not.toBe(before);
  });

  it("reports a findings response that lands after the project was switched — billed, never shown", async () => {
    const gate = deferred<Response>();
    const fetchMock = stubRoutes({ findings: () => gate.promise });

    useAppStore.getState().setModel(degradedModel(), ACTION);
    useAppStore.getState().startNewProject();
    gate.resolve(jsonResponse({ findings: [someFinding("leaked")] }));

    await vi.waitFor(() => expect(outcomes(fetchMock)).toEqual([{ actionId: ACTION, reason: "project-switched" }]));
  });

  it("reports a superseded findings response — recorded as a version, but never displayed", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const handlers = [first, second];
    const fetchMock = stubRoutes({ findings: () => handlers.shift()!.promise });
    useAppStore.setState({ model: degradedModel(), versions: [] });

    useAppStore.getState().commitRework(fixedModel(), ACTION); // request 1 — will be superseded
    useAppStore.getState().commitRework(degradedModel(), OTHER); // request 2 — the latest
    second.resolve(jsonResponse({ findings: [someFinding("newer")] }));
    await vi.waitFor(() => expect(useAppStore.getState().findings).toHaveLength(1));
    expect(outcomes(fetchMock)).toEqual([]); // the shown one is not waste

    first.resolve(jsonResponse({ findings: [someFinding("older")] }));
    await vi.waitFor(() => expect(outcomes(fetchMock)).toEqual([{ actionId: ACTION, reason: "superseded" }]));
    expect(useAppStore.getState().versions.map((v) => v.actionId).sort()).toEqual([ACTION, OTHER].sort());
  });

  it("reports a chat reply that lands after the project was switched, under that message's own action id", async () => {
    const gate = deferred<Response>();
    const fetchMock = stubRoutes({ chat: () => gate.promise });
    useAppStore.setState({ model: degradedModel(), chatMessages: [] });

    const pending = useAppStore.getState().sendChatMessage("add another instance");
    const chatActionId = bodyOf(fetchMock.mock.calls[0]!).actionId;
    expect(chatActionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodyOf(fetchMock.mock.calls[0]!).projectId).toBe(useAppStore.getState().draftProjectId);
    useAppStore.getState().startNewProject();
    gate.resolve(jsonResponse({ isQuestion: false, reply: "Added.", instruction: "Add an instance." }));
    await pending;

    expect(outcomes(fetchMock)).toEqual([{ actionId: chatActionId, reason: "project-switched" }]);
  });

  it("a failing outcome report can't break anything — it's fire-and-forget", async () => {
    const { reportOutcome } = await import("../lib/usageClient");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    expect(() => reportOutcome(ACTION, "withheld")).not.toThrow();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    expect(() => reportOutcome(ACTION, "withheld")).not.toThrow();
    await flush(); // no unhandled rejection
  });
});
