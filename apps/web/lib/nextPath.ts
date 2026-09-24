/**
 * Carrying the page someone was trying to reach across the login screen, so a
 * bookmarked or shared `/project/<id>` still lands there after signing in
 * instead of dumping them on `/`.
 *
 * The value round-trips through the URL (`/login?next=...`) and a cookie, so it
 * is attacker-controllable and gets redirected to — an open-redirect
 * candidate. Everything that reads one goes through `safeNextPath`, which only
 * ever yields a same-origin, path-only value (callers append it to their own
 * origin; it is never used as a URL by itself), or null.
 */

export const NEXT_COOKIE = "archsim_next";
const MAX_LENGTH = 500;
/** Where "next" must never point: the sign-in pages themselves (a loop) and API routes (not pages). */
const EXCLUDED = /^\/(login|auth|api)(\/|\?|#|$)/;

export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (value[0] !== "/") return null;
  // `//host` is protocol-relative, and browsers read `\` as `/`, so `/\host`
  // is the same trick — both leave the site. Control characters and
  // whitespace have no business in a path this came from and enable header /
  // parser tricks.
  if (value[1] === "/" || value[1] === "\\" || value.includes("\\")) return null;
  if (/[\u0000- \u007f]/.test(value)) return null;
  if (EXCLUDED.test(value)) return null;
  // Belt and braces: it must resolve to the same origin as any base.
  try {
    const base = "http://origin.invalid";
    if (new URL(value, base).origin !== base) return null;
  } catch {
    return null;
  }
  return value;
}

/** The validated `next` stored in a `Cookie` request header, if any. */
export function readNextCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== NEXT_COOKIE) continue;
    try {
      return safeNextPath(decodeURIComponent(rest.join("=")));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A `document.cookie` string that remembers `next` for ten minutes. A cookie,
 * not a query parameter on the magic-link redirect: Supabase only honours a
 * redirect URL that matches its configured allow-list, and one with an extra
 * query string may not — which would silently fall back to the site root.
 */
export function nextCookieString(next: string, secure: boolean): string {
  return `${NEXT_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax${secure ? "; Secure" : ""}`;
}
