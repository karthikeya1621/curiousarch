import { NextResponse } from "next/server";
import { isRequestTooLarge } from "./limits";

/**
 * The parts every AI route repeats verbatim — reject an oversized body
 * before parsing it, parse the JSON, and turn an engine failure into a 502
 * carrying its message. Extracted so a fix to any of them (the size guard
 * was added to all five routes by hand, one at a time) lands in one place.
 * Each route still owns its own field validation and its own engine call.
 */
export async function readJsonBody(request: Request): Promise<{ body: unknown } | { error: NextResponse }> {
  if (isRequestTooLarge(request)) {
    return { error: NextResponse.json({ error: "Request body too large." }, { status: 413 }) };
  }
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }) };
  }
}

/** Shown when the engine refused to return a result because it broke a rule (see the engine's finalGate.ts). */
export const UNSAFE_RESULT_MESSAGE =
  "We couldn't apply this safely, so nothing was changed. Please try again, or word the request a little differently.";

/**
 * A failure from the engine call itself. Two kinds, neither of which should reach a
 * customer as raw text (the old behaviour returned the engine's message verbatim,
 * which included truncated model JSON and provider billing errors):
 *  - the engine's own final gate refused the result (`ModelGateError`): 422 with a
 *    fixed message and `code: "unsafe-result"`, so the client knows nothing was
 *    applied and can report the attempt as withheld;
 *  - anything else (validation exhausted, the provider erroring): 502 with a
 *    friendly message; the real error is logged here and returned as `detail` only
 *    outside production.
 */
export function upstreamError(err: unknown, fallback: string): NextResponse {
  if (err instanceof Error && err.name === "ModelGateError") {
    console.error("[api] result withheld by the final gate:", err.message);
    return NextResponse.json({ error: UNSAFE_RESULT_MESSAGE, code: "unsafe-result" }, { status: 422 });
  }
  console.error("[api] upstream failure:", err);
  const detail = err instanceof Error ? err.message : fallback;
  return NextResponse.json(
    { error: `${fallback} Your project is unchanged - please try again in a moment.`, ...(process.env.NODE_ENV === "production" ? {} : { detail }) },
    { status: 502 },
  );
}
