import { NextResponse } from "next/server";
import { guestTrialOpen } from "../../../../lib/trial/server";
import { trialConfig } from "../../../../lib/trial/policy";

/**
 * Public (middleware lets it through without a session): the login page asks whether to show "Try as a
 * guest". When the daily budget is spent, or the trial is off, this says so and the option is not shown
 * at all. Reveals only a boolean, never the spend.
 */
export async function GET() {
  return NextResponse.json({ available: await guestTrialOpen(), captcha: trialConfig().captcha }, {
    // The answer is the same for every visitor and costs a database aggregate, so let the CDN absorb repeat hits.
    headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
