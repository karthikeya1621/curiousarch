import { NextResponse } from "next/server";
import { applyAiFix } from "@archsim/engine/server";
import type { AiFinding, AiFix, SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts. Backs "Apply this fix"
 * in the new AI-generated findings flow — the finding/fix themselves are
 * already decided (they came from a prior identify-failures call); this
 * only implements the one already-chosen fix.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { model, finding, fix } =
    (body as { model?: unknown; finding?: unknown; fix?: unknown }) ?? {};
  if (!model || !finding || !fix) {
    return NextResponse.json(
      { error: "Expected { model: SystemModel, finding: AiFinding, fix: AiFix }." },
      { status: 400 },
    );
  }

  try {
    const result = await applyAiFix(model as SystemModel, finding as AiFinding, fix as AiFix);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply fix.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
