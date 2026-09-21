import { NextResponse } from "next/server";
import { explainFix } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";
import { isValidModelShape } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the "Ask AI"
 * affordance on a fix — manually triggered only, never automatic on
 * selection (a fix's own label/tradeoff and the finding's explanation
 * are already visible without this call).
 */
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

  try {
    const { rationale } = await explainFix(model as SystemModel, componentId, fixLabel, findingCode);
    return NextResponse.json({ rationale });
  } catch (err) {
    return upstreamError(err, "Failed to explain fix.");
  }
}
