import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

/**
 * Lands both the email-magic-link redirect and the Google OAuth redirect —
 * both send the browser here with `?code=`, which is exchanged for a real
 * session cookie server-side before sending the user on to the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
