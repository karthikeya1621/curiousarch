/**
 * Carrying a deep link (`/project/<id>`) across login — and, because that
 * value comes from a URL/cookie and is redirected to, not becoming an open
 * redirect. The guard (`safeNextPath`) gets the exhaustive treatment; the
 * middleware and the auth callback are checked to use it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NEXT_COOKIE, nextCookieString, readNextCookie, safeNextPath } from "../lib/nextPath";

describe("safeNextPath", () => {
  it.each(["/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "/", "/admin/usage", "/project/x?tab=1", "/project/x#section"])(
    "accepts a same-site path: %s",
    (p) => expect(safeNextPath(p)).toBe(p),
  );

  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash variant browsers read as //", "/\\evil.example"],
    ["a backslash anywhere", "/a\\b"],
    ["an absolute URL", "https://evil.example/x"],
    ["a scheme-only string", "javascript:alert(1)"],
    ["a relative path", "project/x"],
    ["an empty string", ""],
    ["whitespace inside", "/a b"],
    ["a newline (header injection)", "/a\r\nSet-Cookie: x=1"],
    ["a tab", "/a\tb"],
    ["a NUL byte", "/a\u0000b"],
    ["the login page itself (a loop)", "/login"],
    ["a login sub-path or query", "/login?next=/x"],
    ["the auth callback", "/auth/callback"],
    ["an API route", "/api/chat"],
    ["something over the length cap", "/" + "a".repeat(600)],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("rejects anything that isn't a string", () => {
    for (const value of [null, undefined, 5, {}, ["/x"]]) expect(safeNextPath(value)).toBeNull();
  });

  it("doesn't mistake a lookalike for an excluded page", () => {
    expect(safeNextPath("/loginfoo")).toBe("/loginfoo");
    expect(safeNextPath("/authors")).toBe("/authors");
    expect(safeNextPath("/apiary")).toBe("/apiary");
  });
});

describe("the next cookie", () => {
  it("round-trips a value, ignoring other cookies", () => {
    const value = "/project/abc?x=1&y=2";
    const cookie = nextCookieString(value, false).split(";")[0]!;
    expect(readNextCookie(`theme=dark; ${cookie}; sb-token=zzz`)).toBe(value);
  });

  it("is short-lived, site-wide and Lax, and Secure only when asked", () => {
    expect(nextCookieString("/x", false)).toBe(`${NEXT_COOKIE}=%2Fx; Path=/; Max-Age=600; SameSite=Lax`);
    expect(nextCookieString("/x", true)).toMatch(/; Secure$/);
  });

  it("re-validates on the way out: a tampered cookie is ignored, not trusted", () => {
    expect(readNextCookie(`${NEXT_COOKIE}=${encodeURIComponent("//evil.example")}`)).toBeNull();
    expect(readNextCookie(`${NEXT_COOKIE}=%E0%A4%A`)).toBeNull(); // malformed encoding
    expect(readNextCookie("other=1")).toBeNull();
    expect(readNextCookie(null)).toBeNull();
    expect(readNextCookie("")).toBeNull();
  });
});

// ---- middleware ----

const auth = { user: null as { id: string } | null };
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}));
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));
const exchange = vi.fn(async () => ({ error: null }));

describe("middleware: signed-out visitors", () => {
  beforeEach(() => {
    auth.user = null;
  });
  const run = async (path: string) => {
    const { middleware } = await import("../middleware");
    return middleware(new NextRequest(`http://localhost:3000${path}`));
  };

  it("sends a signed-out deep link to login carrying where they were headed", async () => {
    const res = await run("/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?tab=2");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?tab=2");
  });

  it("adds nothing for `/` — that's where login goes anyway", async () => {
    const location = new URL((await run("/")).headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
  });

  it("doesn't carry an API path, which isn't somewhere to land", async () => {
    const location = new URL((await run("/api/chat")).headers.get("location")!);
    expect(location.search).toBe("");
  });

  it("lets a signed-in user through untouched, and never redirects the login page itself", async () => {
    auth.user = { id: "u" };
    expect((await run("/project/x")).headers.get("location")).toBeNull();
    auth.user = null;
    expect((await run("/login?next=/project/x")).headers.get("location")).toBeNull();
  });
});

// ---- auth callback ----

describe("GET /auth/callback", () => {
  beforeEach(() => exchange.mockClear());
  const get = async (url: string, cookie?: string) => {
    const { GET } = await import("../app/auth/callback/route");
    return GET(new Request(url, { headers: cookie ? { cookie } : {} }));
  };
  const cookieFor = (next: string) => `${NEXT_COOKIE}=${encodeURIComponent(next)}`;

  it("exchanges the code, then lands on the page they were headed for and clears the cookie", async () => {
    const res = await get("http://localhost:3000/auth/callback?code=abc", cookieFor("/project/xyz"));
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/project/xyz");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${NEXT_COOKIE}=;.*Max-Age=0`, "i"));
  });

  it("falls back to `/` with no stored destination", async () => {
    expect((await get("http://localhost:3000/auth/callback?code=abc")).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("never redirects off-site, however the destination arrives — cookie or query", async () => {
    for (const evil of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const viaCookie = await get("http://localhost:3000/auth/callback?code=abc", cookieFor(evil));
      expect(viaCookie.headers.get("location")).toBe("http://localhost:3000/");
      const viaQuery = await get(`http://localhost:3000/auth/callback?code=abc&next=${encodeURIComponent(evil)}`);
      expect(viaQuery.headers.get("location")).toBe("http://localhost:3000/");
    }
  });

  it("accepts a valid ?next= when there's no cookie (e.g. the magic link opened in another browser)", async () => {
    const res = await get("http://localhost:3000/auth/callback?code=abc&next=%2Fproject%2Fxyz");
    expect(res.headers.get("location")).toBe("http://localhost:3000/project/xyz");
  });
});
