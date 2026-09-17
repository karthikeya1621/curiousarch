import { NextResponse } from "next/server";
import { reworkModel } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the "Re-simulate"
 * button: a full rebuild of the current model, seeded from its own current
 * state instead of typed prose. Same response shape as api/infer/route.ts
 * (`{ model }` on success) since it's the same category of operation —
 * produce a model, never a finding.
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
    const result = await reworkModel(model as SystemModel);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rework failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
