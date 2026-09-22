import { after } from "next/server";
import type { AiCallRecord } from "@archsim/engine/server";
import { createClient } from "../supabase/server";
import { getAdminClient } from "../supabase/admin";
import { readUsageIds } from "./ids";
import { loadPrices } from "./pricing";
import { createUsageRecorder, type UsageAction, type UsageSink } from "./recorder";

/**
 * The web app's wiring for usage tracking — everything a route needs, in one
 * call. Spread the result into the engine call's options:
 *
 *   const usage = await startUsage(body, { action: "chat", context: {...} });
 *   await chatWithProject(..., usage);
 *
 * Resolves to `{}` (tracking off, the AI call unaffected) if there's no
 * service-role key configured, no signed-in user, or anything at all goes
 * wrong setting up — observing a call must never be able to stop it.
 */
export async function startUsage(
  body: unknown,
  meta: { action: UsageAction; context?: Record<string, unknown> },
): Promise<{ onCall?: (record: AiCallRecord) => void }> {
  try {
    const admin = getAdminClient();
    if (!admin) return {};
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};

    const { actionId, projectId } = readUsageIds(body);
    const sink: UsageSink = {
      async insertCall(row) {
        const { error } = await admin.from("ai_calls").insert(row);
        if (error) throw new Error(`ai_calls insert failed: ${error.message}`);
      },
      async insertPayload(row) {
        const { error } = await admin.from("ai_call_payloads").insert(row);
        if (error) throw new Error(`ai_call_payloads insert failed: ${error.message}`);
      },
    };
    return {
      onCall: createUsageRecorder(
        { userId: user.id, projectId, actionId, action: meta.action, context: meta.context ?? {} },
        {
          sink,
          prices: loadPrices(),
          // On by default (short-retention debugging value: exactly what was
          // sent and returned); AI_USAGE_LOG_PAYLOADS=false keeps metrics only.
          logPayloads: !["false", "0"].includes(process.env.AI_USAGE_LOG_PAYLOADS ?? ""),
          // Runs after the response is sent. Outside a request (a test, a
          // script) `after` throws — then the write just starts immediately.
          schedule: (work) => {
            try {
              after(work);
            } catch {
              void work();
            }
          },
        },
      ),
    };
  } catch (err) {
    console.error("[usage] tracking unavailable for this request:", err);
    return {};
  }
}
