import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { isAdminUser } from "../../../../lib/admin";

/**
 * Answers one question about the CALLER only: are you an admin? Exists
 * because `ADMIN_EMAILS` is a server-only variable (the allow-list must never
 * be shipped to a browser), so the header can't decide client-side whether to
 * show the usage link. It reveals nothing about anyone else, and it isn't the
 * gate — /admin/usage does its own `requireAdmin()` before reading any data;
 * this only decides whether a convenience link is drawn. Any failure
 * (signed out, Supabase down) is simply "not an admin", never an error.
 */
export async function GET() {
  let isAdmin = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAdmin = isAdminUser(user);
  } catch {
    isAdmin = false;
  }
  return NextResponse.json({ isAdmin }, { headers: { "cache-control": "no-store" } });
}
