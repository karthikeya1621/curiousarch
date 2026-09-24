/**
 * `/project/<id>` <-> open-project sync. All of it is a pure function
 * (lib/projectRoute.ts), so every case — and, more importantly, the
 * guarantee that the URL and the store never fight each other — is checked
 * here without a browser.
 */

import { describe, expect, it } from "vitest";
import { decideRouteSync, parseProjectPath, projectPath, type RouteSyncAction } from "../lib/projectRoute";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("parseProjectPath / projectPath", () => {
  it("round-trips a project id", () => {
    expect(projectPath(A)).toBe(`/project/${A}`);
    expect(parseProjectPath(projectPath(A))).toBe(A);
  });

  it("accepts a trailing slash, and returns null for every other path", () => {
    expect(parseProjectPath(`/project/${A}/`)).toBe(A);
    for (const path of ["/", "/login", "/admin/usage", "/project", "/project/", `/project/${A}/extra`, `/projects/${A}`]) {
      expect(parseProjectPath(path), path).toBeNull();
    }
  });

  it("hands back whatever segment is there — validity is decided by whether it loads, not by its shape", () => {
    expect(parseProjectPath("/project/not-a-uuid")).toBe("not-a-uuid");
  });

  it("escapes and unescapes an id with unusual characters", () => {
    expect(projectPath("a b/c")).toBe("/project/a%20b%2Fc");
    expect(parseProjectPath("/project/a%20b%2Fc")).toBe("a b/c");
  });
});

describe("decideRouteSync", () => {
  const first = (routeId: string | null, currentId: string | null) =>
    decideRouteSync({ hydrated: true, routeId, currentId, prev: null });
  const later = (
    prev: { routeId: string | null; currentId: string | null },
    routeId: string | null,
    currentId: string | null,
  ) => decideRouteSync({ hydrated: true, routeId, currentId, prev });
  const none: RouteSyncAction = { type: "none" };

  it("decides nothing until the initial restore has finished", () => {
    expect(decideRouteSync({ hydrated: false, routeId: A, currentId: null, prev: null })).toEqual(none);
    expect(decideRouteSync({ hydrated: false, routeId: null, currentId: B, prev: null })).toEqual(none);
  });

  describe("right after the initial restore", () => {
    it("a deep link that loaded is already in sync", () => {
      expect(first(A, A)).toEqual(none);
    });

    it("a deep link that did NOT load is missing — the restore either failed or showed something else", () => {
      expect(first(A, null)).toEqual({ type: "missing", id: A });
      expect(first(A, B)).toEqual({ type: "missing", id: A });
    });

    it("`/` that resumed the last project gets that project's URL, replacing `/` rather than stacking a history entry", () => {
      expect(first(null, B)).toEqual({ type: "navigate", to: projectPath(B), mode: "replace" });
    });

    it("`/` with nothing to resume stays `/`", () => {
      expect(first(null, null)).toEqual(none);
    });
  });

  describe("only the URL moved (typed, back/forward) — the store follows", () => {
    it("to a project the store isn't showing: open it", () => {
      expect(later({ routeId: B, currentId: B }, A, B)).toEqual({ type: "open", id: A });
    });

    it("to the project already open: nothing to do", () => {
      expect(later({ routeId: null, currentId: A }, A, A)).toEqual(none);
    });

    it("to a path with no project while one is open: restore that project's URL rather than leave a lying address", () => {
      expect(later({ routeId: A, currentId: A }, null, A)).toEqual({ type: "navigate", to: projectPath(A), mode: "replace" });
    });

    it("to a path with no project and nothing open: nothing", () => {
      expect(later({ routeId: A, currentId: null }, null, null)).toEqual(none);
    });
  });

  describe("only the store moved — the URL follows", () => {
    it("a new project getting its first saved id (autosave): replace, so history isn't cluttered", () => {
      expect(later({ routeId: null, currentId: null }, null, A)).toEqual({
        type: "navigate",
        to: projectPath(A),
        mode: "replace",
      });
    });

    it("switching between two saved projects: push, so Back returns to the previous one", () => {
      expect(later({ routeId: A, currentId: A }, A, B)).toEqual({ type: "navigate", to: projectPath(B), mode: "push" });
    });

    it("starting a new project / deleting the open one: back to `/`", () => {
      expect(later({ routeId: A, currentId: A }, A, null)).toEqual({ type: "navigate", to: "/", mode: "replace" });
    });

    it("the URL already agrees: nothing to do", () => {
      expect(later({ routeId: null, currentId: A }, A, A)).toEqual(none);
    });
  });

  it("when both moved at once the URL wins", () => {
    expect(later({ routeId: A, currentId: A }, B, C)).toEqual({ type: "open", id: B });
  });

  it("decides nothing when neither moved", () => {
    expect(later({ routeId: A, currentId: A }, A, A)).toEqual(none);
  });

  it("leaves a not-found page alone: the URL names a project that couldn't load while another is open, and nothing moved — don't yank the user off it", () => {
    expect(later({ routeId: B, currentId: A }, B, A)).toEqual(none);
  });
});

/**
 * The real risk in two things each following the other is a loop. This runs
 * the decisions against a stand-in browser and store — `navigate` rewrites
 * the URL, `open` loads a project (or fails) — and checks each scenario
 * SETTLES: the decision goes quiet within a couple of steps and the URL and
 * store agree. A ping-pong would blow the step limit.
 */
describe("the URL and the store settle instead of fighting", () => {
  function simulate(start: { route: string | null; current: string | null }, events: ((s: Sim) => void)[], known: string[]) {
    const s: Sim = { route: start.route, current: start.current, prev: null, known: new Set(known), steps: 0 };
    settle(s);
    for (const event of events) {
      event(s);
      settle(s);
    }
    return s;
  }
  interface Sim {
    route: string | null;
    current: string | null;
    prev: { routeId: string | null; currentId: string | null } | null;
    known: Set<string>;
    steps: number;
  }
  function settle(s: Sim) {
    for (let i = 0; i < 6; i++) {
      const action = decideRouteSync({ hydrated: true, routeId: s.route, currentId: s.current, prev: s.prev });
      s.prev = { routeId: s.route, currentId: s.current };
      if (action.type === "none" || action.type === "missing") return;
      s.steps++;
      if (action.type === "navigate") s.route = parseProjectPath(action.to);
      if (action.type === "open" && s.known.has(action.id)) s.current = action.id;
    }
    throw new Error("the URL and the store never settled — they are fighting");
  }

  it("resuming the last project from `/`", () => {
    const s = simulate({ route: null, current: A }, [], [A]);
    expect(s.route).toBe(A);
    expect(s.current).toBe(A);
  });

  it("a first save, then switching projects, then Back, then Forward", () => {
    const s = simulate(
      { route: null, current: null },
      [
        (x) => (x.current = A), // autosave assigns the first id
        (x) => (x.current = B), // user picks project B
        (x) => (x.route = A), // Back
        (x) => (x.route = B), // Forward
      ],
      [A, B],
    );
    expect([s.route, s.current]).toEqual([B, B]);
  });

  it("Back to a project while another is open ends with the store showing the URL's project, no loop", () => {
    const s = simulate({ route: A, current: A }, [(x) => (x.current = B), (x) => (x.route = A)], [A, B]);
    expect([s.route, s.current]).toEqual([A, A]);
  });

  it("starting a new project returns to `/`, and building in it moves to the new id", () => {
    const s = simulate({ route: A, current: A }, [(x) => (x.current = null), (x) => (x.current = C)], [A, C]);
    expect([s.route, s.current]).toEqual([C, C]);
  });

  it("a link to a project that can't be opened doesn't loop or clobber what's open", () => {
    const s = simulate({ route: A, current: A }, [(x) => (x.route = B)], [A]); // B unknown
    expect(s.current).toBe(A);
    expect(s.steps).toBeLessThan(6);
  });
});
