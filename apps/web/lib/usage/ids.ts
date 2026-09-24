/**
 * The two ids the client attaches to every AI request so its calls can be
 * grouped and traced (see lib/usage/recorder.ts):
 *  - `actionId` — one per user action (a build, a Re-simulate, a chat
 *    message...). Every API call that action makes shares it, and the
 *    version it produces stores it, which is how a version is joined back to
 *    what it cost. Versions live inside the project's JSON, not in a table,
 *    so this id is the only possible join key.
 *  - `projectId` — which project it was for. Minted client-side before the
 *    first save (see `draftProjectId` in lib/store/slices/projectSlice.ts), because a project's first
 *    Build — the most expensive action — happens before it exists in the DB.
 * Both are client-supplied, so they're only ever used as labels on the
 * caller's own rows, never to look anything up or authorize anything.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function readUsageIds(body: unknown): { actionId: string; projectId: string | null } {
  const { actionId, projectId } = (body as { actionId?: unknown; projectId?: unknown } | null) ?? {};
  return {
    // A request without a usable id still gets tracked, just as its own one-call action.
    actionId: isUuid(actionId) ? actionId : crypto.randomUUID(),
    projectId: isUuid(projectId) ? projectId : null,
  };
}
