import { MAX_TOTAL_COMPONENTS } from "@archsim/engine";

/**
 * Client-and-server-shared input guardrails — a longer, denser
 * description tends to produce a bigger (and correspondingly more
 * expensive to generate and re-generate) model, on top of the engine's
 * own MAX_BASE_COMPONENTS/MAX_TOTAL_COMPONENTS caps (packages/engine/src/
 * types.ts). This one lives here, not there, since it's about the input
 * side (what the user types) rather than the model the AI produces.
 * Enforced in both `ProseInput.tsx` (so a user sees the limit before
 * hitting it) and `/api/infer/route.ts` (so it holds even for a request
 * that skips the UI entirely) — the same number, not two.
 */
export const MAX_DESCRIPTION_LENGTH = 1500;

/**
 * Same idea, for a chat message — `/api/chat`'s `message` field had no
 * cap at all until this was added (found in a security review: unlike
 * every other free-text field a user controls, it went straight into a
 * prompt with zero length check, client or server).
 */
export const MAX_CHAT_MESSAGE_LENGTH = 1500;

/**
 * Most chat-requested changes that can be waiting for a Re-simulate at once.
 * Every one is sent to the AI as explicit context on the next rework (and to
 * every chat message in between), so an unbounded queue is unbounded prompt
 * growth; the same cap is enforced client-side (the chat slice refuses to queue
 * past it) and server-side (/api/chat and /api/rework reject a bigger queue).
 */
export const MAX_PENDING_CHANGES = 10;

/**
 * Cap on the raw request body size for every route that accepts an
 * EXISTING client-submitted model back (`/api/chat`, `/api/identify-
 * failures`, `/api/rework`, `/api/explain-fix`) rather than building a
 * fresh one from prose. Checked against the `content-length` header
 * before the body is even parsed, so an oversized payload is rejected
 * cheaply rather than after paying the JSON.parse cost.
 *
 * Found in the same review: those four routes never re-validate the
 * incoming model's shape against `SystemModelSchema` at all — they only
 * check it's truthy, then cast straight to `SystemModel`. That schema
 * couldn't be reused here even if they wanted to (a real model may
 * legitimately contain extended-kind components `SystemModelSchema`'s
 * discriminated union doesn't cover — see `extendedComponents.ts`), so
 * this is deliberately a size check, not a shape-perfect one: a
 * logged-in user (magic-link signup is free and instant, no gating) could
 * otherwise hand-craft an oversized model in curl and POST it directly,
 * bypassing `MAX_TOTAL_COMPONENTS` entirely (that cap is only enforced
 * when the AI itself generates a model) and driving arbitrarily expensive
 * Claude calls. A legitimate model — even MAX_TOTAL_COMPONENTS components,
 * each with several trait objects and rationale text, plus chat history
 * and findings — comes in well under this.
 */
export const MAX_REQUEST_BYTES = 200_000;

/**
 * Schema-agnostic structural check for a client-submitted `model` — just
 * enough to catch a hand-crafted payload trying to skip the AI generation
 * step and smuggle in more components/edges than any real build could
 * produce. Not exhaustive type-checking: the engine's own inference calls
 * already tolerate a somewhat-malformed model fine (they reason over
 * whatever JSON they're given), so this only guards against size abuse,
 * on top of `MAX_REQUEST_BYTES`'s raw-byte check.
 */
export function isValidModelShape(model: unknown): boolean {
  if (typeof model !== "object" || model === null) return false;
  const { components, edges } = model as Record<string, unknown>;
  if (!Array.isArray(components) || components.length > MAX_TOTAL_COMPONENTS) return false;
  if (!Array.isArray(edges) || edges.length > MAX_TOTAL_COMPONENTS * MAX_TOTAL_COMPONENTS) return false;
  return true;
}

/**
 * Pre-parse guard for the same four routes — checked before
 * `request.json()` runs at all, so a deliberately huge body is rejected
 * without ever paying the cost of parsing it. Relies on the browser (or
 * any well-behaved client) sending an accurate `content-length`; a
 * request crafted to omit it or use chunked transfer encoding skips this
 * specific check, which is exactly why `isValidModelShape`'s post-parse
 * array-length check exists as a second, independent layer.
 */
export function isRequestTooLarge(request: Request): boolean {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  return contentLength > MAX_REQUEST_BYTES;
}

/**
 * Shape check for a client-submitted queue of chat changes (`/api/chat`,
 * `/api/rework`): a bounded array of `{ request, instruction, kinds? }`, each
 * within the chat-message length cap — these go straight into a prompt, so
 * they get the same treatment `message` does. `instruction` is AI-written but
 * round-trips through the client, so it's untrusted here too.
 */
export function parsePendingChanges(value: unknown): { request: string; instruction: string; kinds?: string[] }[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PENDING_CHANGES) return null;
  const out: { request: string; instruction: string; kinds?: string[] }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { request, instruction, kinds } = item as Record<string, unknown>;
    if (typeof request !== "string" || typeof instruction !== "string") return null;
    if (request.length > MAX_CHAT_MESSAGE_LENGTH || instruction.length > MAX_CHAT_MESSAGE_LENGTH) return null;
    // `kinds` is optional (older queued changes lack it) and, like the rest, untrusted:
    // a short list of short strings or it is dropped, never an error.
    const okKinds =
      Array.isArray(kinds) && kinds.length <= 12 && kinds.every((k) => typeof k === "string" && k.length <= 40)
        ? (kinds as string[])
        : undefined;
    out.push(okKinds ? { request, instruction, kinds: okKinds } : { request, instruction });
  }
  return out;
}
