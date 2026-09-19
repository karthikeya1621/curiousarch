import { NextResponse } from "next/server";
import { fromProse } from "@archsim/engine/server";
import { MAX_DESCRIPTION_LENGTH } from "../../../lib/limits";

/**
 * Server-only: pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY via
 * @archsim/engine/server (never the public barrel — see that package's
 * index.ts for why). Node runtime is the default for route handlers, which
 * is required here since the Anthropic SDK isn't Edge-compatible.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const description = (body as { description?: unknown })?.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json(
      { error: "Expected a non-empty string field \"description\"." },
      { status: 400 },
    );
  }
  // Same limit ProseInput.tsx enforces client-side — checked again here so
  // it holds for any request, not just ones that went through that form.
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `Description is too long (${description.length} characters, max ${MAX_DESCRIPTION_LENGTH}).` },
      { status: 400 },
    );
  }

  try {
    const result = await fromProse(description);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inference failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
