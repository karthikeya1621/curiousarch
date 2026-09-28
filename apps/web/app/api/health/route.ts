import { NextResponse } from "next/server";

/**
 * Liveness probe for the host / uptime monitor. Public and deliberately shallow: it says the server
 * is up, nothing about configuration or dependencies (no secrets, no Supabase call that could turn a
 * blip into an outage report or be used to probe the deployment).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
