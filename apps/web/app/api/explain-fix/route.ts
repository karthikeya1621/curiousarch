import { NextResponse } from "next/server";
import { explainFix } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";
import { reserveTrial } from "../../../lib/trial/server";
import { describeModel } from "../../../lib/usage/context";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the "Ask AI"
 * affordance on a fix — manually triggered only, never automatic on
 * selection (a fix's own label/tradeoff and the finding's explanation
 * are already visible without this call).
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

  const { model, componentId, fixLabel, findingCode } =
    (body as { model?: unknown; componentId?: unknown; fixLabel?: unknown; findingCode?: unknown }) ?? {};
  if (
    !model ||
    !isValidModelShape(model) ||
    typeof componentId !== "string" ||
    typeof fixLabel !== "string" ||
    typeof findingCode !== "string"
  ) {
    return NextResponse.json(
      {
        error:
          "Expected { model: SystemModel, componentId: string, fixLabel: string, findingCode: string } — model must be a valid, reasonably-sized SystemModel.",
      },
      { status: 400 },
    );
  }

  // A guest's quota is counted here, before the engine runs (no-op for signed-in users).
  const gate = await reserveTrial(request, body, "explain-fix");
  if (gate.denied) return gate.denied;
  try {
    const usage = await startUsage(body, {
      action: "explain-fix",
      context: { ...describeModel(model as SystemModel), findingCode },
    });
    const { rationale } = await explainFix(model as SystemModel, componentId, fixLabel, findingCode, usage);
    return NextResponse.json({ rationale });
  } catch (err) {
    await gate.release(); // a failed or refused attempt is not counted
    return upstreamError(err, "Failed to explain fix.");
  }
}
