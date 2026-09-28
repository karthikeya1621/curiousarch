import { NextResponse } from "next/server";
import { fromProse } from "@archsim/engine/server";
import { MAX_DESCRIPTION_LENGTH } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";
import { reserveTrial } from "../../../lib/trial/server";

/**
 * Server-only: pulls in @anthropic-ai/sdk and reads ANTHROPIC_API_KEY via
 * @archsim/engine/server (never the public barrel — see that package's
 * index.ts for why). Node runtime is the default for route handlers, which
 * is required here since the Anthropic SDK isn't Edge-compatible.
 */
/**
 * A build chains several model calls and a failed final gate repeats them, so the platform's default function limit
 * would cut it off mid-flight (after the provider has already billed it, and before the quota slot could be released).
 * Lower this if the hosting plan caps functions below it.
 */
export const maxDuration = 300;

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

  // A guest's quota is counted here, before the engine runs (no-op for signed-in users).
  const gate = await reserveTrial(request, body, "build");
  if (gate.denied) return gate.denied;
  try {
    const usage = await startUsage(body, { action: "build", context: { descriptionChars: description.length } });
    const result = await fromProse(description, usage);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    await gate.release(); // a failed or refused attempt is not counted
    return upstreamError(err, "Inference failed.");
  }
}
