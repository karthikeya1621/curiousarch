import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { getAdminClient } from "../../../../lib/supabase/admin";
import { isUuid } from "../../../../lib/usage/ids";
import { readJsonBody } from "../../../../lib/apiRoute";
import { USAGE_OUTCOME_REASONS } from "../../../../lib/usage/outcomes";
import { refundWithheldRework } from "../../../../lib/trial/server";

/**
 * Records that an AI response the user paid for never reached them — the
 * client is the only party that knows (the project was switched while it was
 * in flight, a newer request superseded it, a Re-simulate result was
 * withheld because the queue changed). Insert-only, into its own table
 * rather than an update on `ai_calls`: the report can arrive before the call
 * rows are even written (they're written after the response is sent), and an
 * update would silently match nothing. Best-effort by design — always 204,
 * because the client neither waits on nor cares about the answer.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const { actionId, reason } = (parsed.body as { actionId?: unknown; reason?: unknown }) ?? {};
  if (!isUuid(actionId) || typeof reason !== "string" || !(USAGE_OUTCOME_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json({ error: "Expected { actionId: uuid, reason: one of the known outcome reasons }." }, { status: 400 });
  }

  try {
    const admin = getAdminClient();
    if (admin) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await admin.from("ai_action_outcomes").insert({ user_id: user.id, action_id: actionId, reason });
        // A Re-simulate result the user threw away by editing during the run is given back - once per account,
        // Re-simulate only, verified in the database (the client cannot free an arbitrary action).
        if (reason === "withheld") await refundWithheldRework(user.id, actionId);
      }
    }
  } catch (err) {
    console.error("[usage] failed to record an outcome:", err);
  }
  return new NextResponse(null, { status: 204 });
}
