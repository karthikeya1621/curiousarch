import { NextResponse } from "next/server";
import { identifyFailures } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";
import { reserveTrial } from "../../../lib/trial/server";
import { describeModel } from "../../../lib/usage/context";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the primary
 * findings source for the web app — called after every model change that
 * represents a real user action (a build, an applied fix, a rework), not
 * on every render.
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

  const model = (body as { model?: unknown })?.model;
  if (!model || !isValidModelShape(model)) {
    return NextResponse.json(
      { error: "Expected a field \"model\" (a valid, reasonably-sized SystemModel)." },
      { status: 400 },
    );
  }

  // A guest's quota is counted here, before the engine runs (no-op for signed-in users).
  const gate = await reserveTrial(request, body, "findings");
  if (gate.denied) return gate.denied;
  try {
    const usage = await startUsage(body, { action: "findings", context: describeModel(model as SystemModel) });
    const findings = await identifyFailures(model as SystemModel, usage);
    return NextResponse.json({ findings });
  } catch (err) {
    await gate.release(); // a failed or refused attempt is not counted
    return upstreamError(err, "Failed to identify failures.");
  }
}
