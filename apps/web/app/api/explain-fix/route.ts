import { NextResponse } from "next/server";
import { explainFix } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the "Ask AI"
 * affordance on a fix — manually triggered only, never automatic on
 * selection (a fix's own label/tradeoff and the finding's explanation
 * are already visible without this call).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { model, componentId, fixLabel, findingCode } =
    (body as { model?: unknown; componentId?: unknown; fixLabel?: unknown; findingCode?: unknown }) ?? {};
  if (!model || typeof componentId !== "string" || typeof fixLabel !== "string" || typeof findingCode !== "string") {
    return NextResponse.json(
      { error: "Expected { model: SystemModel, componentId: string, fixLabel: string, findingCode: string }." },
      { status: 400 },
    );
  }

  try {
    const { rationale } = await explainFix(model as SystemModel, componentId, fixLabel, findingCode);
    return NextResponse.json({ rationale });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to explain fix.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
