import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { isAdminUser } from "../../../../lib/admin";
import { trialConfig } from "../../../../lib/trial/policy";

/**
 * Answers about the CALLER only, for shaping the UI (banner, disabled "New project"): are they held
 * to the free quota, and are they a guest? The server enforces the quota regardless; this is a cue.
 * Any failure is "not limited" - the UI then just shows no banner, and the server still decides.
 */
export async function GET() {
  let limited = false;
  let guest = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    guest = Boolean(user?.is_anonymous);
    limited = Boolean(user) && !isAdminUser(user) && (guest || trialConfig().enabled);
  } catch {
    limited = false;
  }
  return NextResponse.json({ limited, guest }, { headers: { "cache-control": "no-store" } });
}
