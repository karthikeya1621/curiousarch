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

/** A failure from the engine call itself (the model output never validated, the API errored) — 502, not the caller's fault. */
export function upstreamError(err: unknown, fallback: string): NextResponse {
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 502 });
}
