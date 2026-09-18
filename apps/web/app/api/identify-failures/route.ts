import { NextResponse } from "next/server";
import { identifyFailures } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the primary
 * findings source for the web app — called after every model change that
 * represents a real user action (a build, an applied fix, a rework), not
 * on every render.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const model = (body as { model?: unknown })?.model;
  if (!model) {
    return NextResponse.json({ error: "Expected a field \"model\" (SystemModel)." }, { status: 400 });
  }

  try {
    const findings = await identifyFailures(model as SystemModel);
    return NextResponse.json({ findings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to identify failures.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
