import { NextResponse } from "next/server";
import { reworkModel } from "@archsim/engine/server";
import type { PendingFixInput } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the "Re-simulate"
 * button: a full rebuild of the current model, seeded from its own current
 * state instead of typed prose. Same response shape as api/infer/route.ts
 * (`{ model }` on success) since it's the same category of operation —
 * produce a model, never a finding.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;

  const { model, pendingFixes } = (body as { model?: unknown; pendingFixes?: unknown }) ?? {};
  if (!model || !isValidModelShape(model)) {
    return NextResponse.json(
      { error: "Expected a field \"model\" (a valid, reasonably-sized SystemModel)." },
      { status: 400 },
    );
  }

  try {
    const result = await reworkModel(
      model as SystemModel,
      Array.isArray(pendingFixes) ? (pendingFixes as PendingFixInput[]) : [],
    );
    return NextResponse.json({ model: result.model });
  } catch (err) {
    return upstreamError(err, "Rework failed.");
  }
}
