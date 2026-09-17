import { NextResponse } from "next/server";
import { proposeCacheTraits } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts: pulls in
 * @anthropic-ai/sdk and reads ANTHROPIC_API_KEY via @archsim/engine/server.
 *
 * Only ever called for a fix with `hasAiProposal: true` — today that's
 * exactly one fix ("db:add-cache"). The engine, not this route, decides
 * whether the given component is a valid target (it throws if not).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { model, componentId } = (body as { model?: unknown; componentId?: unknown }) ?? {};
  if (!model || typeof componentId !== "string" || componentId.trim().length === 0) {
    return NextResponse.json(
      { error: "Expected { model: SystemModel, componentId: string }." },
      { status: 400 },
    );
  }

  try {
    const proposal = await proposeCacheTraits(model as SystemModel, componentId);
    return NextResponse.json({ proposal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proposal failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
