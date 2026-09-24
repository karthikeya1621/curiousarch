/**
 * URL <-> open-project synchronisation for `/project/<id>`.
 *
 * Two things can move independently and each must be able to drive the
 * other: the URL (a deep link, a bookmark, back/forward) and the store's
 * `currentProjectId` (first save assigns an id, the user picks another
 * project, starts a new one). The rule that keeps them from fighting is
 * "whichever changed since we last looked is the boss": if only the URL
 * changed the store follows it, if only the store changed the URL follows
 * it. Deciding that is a pure function of the two current values and the two
 * previous ones, kept out of the component so every case can be tested
 * without a browser (see tests/project-route.test.ts) — the component just
 * carries out whatever it returns.
 */

const PROJECT_PATH = /^\/project\/([^/]+)\/?$/;

/** `/project/<id>` for a saved project. */
export function projectPath(id: string): string {
  return `/project/${encodeURIComponent(id)}`;
}

/**
 * The id segment of a `/project/<id>` pathname, or null for any other path.
 * Deliberately not validated as a uuid here: an id that isn't one simply
 * fails to load and the page says "not found", one behaviour for every kind
 * of bad link.
 */
export function parseProjectPath(pathname: string): string | null {
  const match = PROJECT_PATH.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export interface RouteSyncInput {
  /** False until the initial restore has finished — nothing is decided before then. */
  hydrated: boolean;
  /** The id in the URL (`/project/<id>`), or null on any other path. */
  routeId: string | null;
  /** The store's `currentProjectId`: the saved project on screen, or null. */
  currentId: string | null;
  /** The two values as of the previous decision; null for the first one after hydration. */
  prev: { routeId: string | null; currentId: string | null } | null;
}

export type RouteSyncAction =
  | { type: "none" }
  /** The URL is the boss and names a project the store isn't showing: load it. */
  | { type: "open"; id: string }
  /** The store is the boss: move the URL (push between two saved projects, replace otherwise). */
  | { type: "navigate"; to: string; mode: "push" | "replace" }
  /** The URL names a project that couldn't be shown. */
  | { type: "missing"; id: string };

export function decideRouteSync({ hydrated, routeId, currentId, prev }: RouteSyncInput): RouteSyncAction {
  if (!hydrated) return { type: "none" };

  /** Make the URL match a project that's open but isn't in the address bar. */
  const followStore = (mode: "push" | "replace"): RouteSyncAction =>
    currentId ? { type: "navigate", to: projectPath(currentId), mode } : { type: "none" };

  // First decision after the restore finished. A deep link is authoritative:
  // if the restore didn't end up showing it, it couldn't be loaded. Anywhere
  // else, an open project just gets its URL.
  if (prev === null) {
    if (routeId !== null) return routeId === currentId ? { type: "none" } : { type: "missing", id: routeId };
    return followStore("replace");
  }

  const routeChanged = prev.routeId !== routeId;
  const currentChanged = prev.currentId !== currentId;

  // The URL moved (typed, back/forward) — or both did at once, where the URL
  // wins. The store follows it.
  if (routeChanged) {
    if (routeId !== null) return routeId === currentId ? { type: "none" } : { type: "open", id: routeId };
    // Navigated to a path with no project in it while one is open: put the
    // project's own URL back rather than leaving an address that lies.
    return followStore("replace");
  }

  // Only the store moved. The URL follows — unless it already agrees.
  if (currentChanged) {
    if (routeId === currentId) return { type: "none" };
    if (currentId === null) return { type: "navigate", to: "/", mode: "replace" };
    // Picking another saved project is a step in history (back returns to
    // the previous one); a project getting its first id is not.
    return followStore(prev.currentId !== null ? "push" : "replace");
  }

  return { type: "none" };
}
