import { NextResponse } from "next/server";
import { fromProse } from "@archsim/engine/server";
import { MAX_DESCRIPTION_LENGTH } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";

/**
 * Server-only: pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY via
 * @archsim/engine/server (never the public barrel — see that package's
 * index.ts for why). Node runtime is the default for route handlers, which
 * is required here since the Anthropic SDK isn't Edge-compatible.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;

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
    const usage = await startUsage(body, { action: "build", context: { descriptionChars: description.length } });
    const result = await fromProse(description, usage);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    return upstreamError(err, "Inference failed.");
  }
}
