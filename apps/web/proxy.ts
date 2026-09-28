import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "./lib/nextPath";

/**
 * Gates every page AND every AI API route (chat, rework, infer,
 * identify-failures, explain-fix) behind login in one place — this is what
 * actually stops an anonymous visitor from burning live Anthropic API
 * calls, not something each of those five routes needs to check itself.
 *
 * Also refreshes the Supabase session cookie on every request — required
 * so a Server Component's read-only cookie access (see
 * lib/supabase/server.ts) still sees a valid, non-expired session.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    // Legal pages must be readable before signing in (Google sign-in and the login footer link to them).
    request.nextUrl.pathname === "/privacy" ||
    request.nextUrl.pathname === "/terms" ||
    // The login page asks this before a session exists (whether to offer "Try as a guest").
    request.nextUrl.pathname === "/api/trial/status";

  if (!user && !isAuthRoute) {
    const target = request.nextUrl.pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Remember where they were headed (a shared /project/<id> link) so login
    // can send them back — validated, and left off for `/` since that's
    // where login goes anyway.
    const next = safeNextPath(target);
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Static assets, the crawler/manifest files and the health probe never need a session (a redirect on
  // robots.txt or the sitemap would hide the whole site from search engines).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
