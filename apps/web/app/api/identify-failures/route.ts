import { NextResponse } from "next/server";
import { identifyFailures } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the primary
 * findings source for the web app — called after every model change that
 * represents a real user action (a build, an applied fix, a rework), not
 * on every render.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;

  const model = (body as { model?: unknown })?.model;
  if (!model || !isValidModelShape(model)) {
    return NextResponse.json(
      { error: "Expected a field \"model\" (a valid, reasonably-sized SystemModel)." },
      { status: 400 },
    );
  }

  try {
    const findings = await identifyFailures(model as SystemModel);
    return NextResponse.json({ findings });
  } catch (err) {
    return upstreamError(err, "Failed to identify failures.");
  }
}
