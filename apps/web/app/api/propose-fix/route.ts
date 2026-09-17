import { NextResponse } from "next/server";
import { proposeCacheTraits, explainFix } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts: pulls in
 * @anthropic-ai/sdk and reads ANTHROPIC_API_KEY via @archsim/engine/server.
 *
 * Called for every fix now, not just one — `hasAiProposal` (the single
 * source of truth for which kind of call a fix gets, defined once in
 * fixes.ts) decides which AI call actually runs: `true` (today only
 * "db:add-cache") calls proposeCacheTraits, which can influence the
 * fix's transform; every other fix calls explainFix, which only produces
 * narration and can never change anything the engine computes.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { model, componentId, fixLabel, findingCode, hasAiProposal } =
    (body as {
      model?: unknown;
      componentId?: unknown;
      fixLabel?: unknown;
      findingCode?: unknown;
      hasAiProposal?: unknown;
    }) ?? {};

  if (!model || typeof componentId !== "string" || componentId.trim().length === 0) {
    return NextResponse.json(
      { error: "Expected { model: SystemModel, componentId: string, fixLabel: string, findingCode: string }." },
      { status: 400 },
    );
  }

  try {
    if (hasAiProposal) {
      const proposal = await proposeCacheTraits(model as SystemModel, componentId);
      return NextResponse.json({ proposal });
    }
    const { rationale } = await explainFix(
      model as SystemModel,
      componentId,
      typeof fixLabel === "string" ? fixLabel : "",
      typeof findingCode === "string" ? findingCode : "",
    );
    return NextResponse.json({ rationale });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI call failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
