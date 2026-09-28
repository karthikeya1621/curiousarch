import { NextResponse } from "next/server";
import { reworkModel } from "@archsim/engine/server";
import type { PendingFixInput } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape, parsePendingChanges } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";
import { reserveTrial } from "../../../lib/trial/server";
import { describeModel } from "../../../lib/usage/context";

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

  const { model, pendingFixes, pendingChanges } =
    (body as { model?: unknown; pendingFixes?: unknown; pendingChanges?: unknown }) ?? {};
  if (!model || !isValidModelShape(model)) {
    return NextResponse.json(
      { error: "Expected a field \"model\" (a valid, reasonably-sized SystemModel)." },
      { status: 400 },
    );
  }

  const queuedChanges = parsePendingChanges(pendingChanges);
  if (queuedChanges === null) {
    return NextResponse.json({ error: "pendingChanges must be a short list of { request, instruction } strings." }, { status: 400 });
  }

  const fixes = Array.isArray(pendingFixes) ? (pendingFixes as PendingFixInput[]) : [];
  // A guest's quota is counted here, before the engine runs (no-op for signed-in users).
  const gate = await reserveTrial(request, body, "rework");
  if (gate.denied) return gate.denied;
  try {
    const usage = await startUsage(body, {
      action: "rework",
      context: { ...describeModel(model as SystemModel), pendingFixes: fixes.length, pendingChanges: queuedChanges.length },
    });
    const result = await reworkModel(model as SystemModel, fixes, queuedChanges, usage);
    return NextResponse.json({ model: result.model });
  } catch (err) {
    await gate.release(); // a failed or refused attempt is not counted
    return upstreamError(err, "Rework failed.");
  }
}
