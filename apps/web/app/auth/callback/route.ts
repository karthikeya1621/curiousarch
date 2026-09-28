import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { NEXT_COOKIE, readNextCookie, safeNextPath } from "../../../lib/nextPath";

/**
 * Lands both the email-magic-link redirect and the Google OAuth redirect —
 * both send the browser here with `?code=`, which is exchanged for a real
 * session cookie server-side before sending the user on to the app — to the
 * page they originally asked for if the login page stashed one (see
 * lib/nextPath.ts), otherwise `/`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // An expired or reused link, or one opened in a different browser than it was requested from (the sign-in
    // uses PKCE), cannot be exchanged. Say so instead of dropping the user on a login page with no explanation.
    if (error) return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const next = readNextCookie(request.headers.get("cookie")) ?? safeNextPath(searchParams.get("next")) ?? "/";
  // Appended to OUR origin, never used as a URL on its own (see safeNextPath).
  const response = NextResponse.redirect(`${origin}${next}`);
  response.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
