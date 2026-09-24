/**
 * The header's "Usage" link: /api/admin/status only ever tells the CALLER
 * whether they're an admin (the allow-list itself stays server-side), fails
 * closed, and the link component draws nothing until that answer arrives —
 * so a regular user never sees a flash of it.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { user: { email?: string; email_confirmed_at?: string } | null; throws: boolean } = {
  user: null,
  throws: false,
};
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => {
    if (authState.throws) throw new Error("supabase down");
    return { auth: { getUser: async () => ({ data: { user: authState.user } }) } };
  },
}));
// next/link needs the app router mounted; a plain anchor is enough here.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { GET } = await import("../app/api/admin/status/route.ts");

describe("GET /api/admin/status", () => {
  const confirmed = "2026-01-01T00:00:00Z";
  beforeEach(() => {
    authState.user = null;
    authState.throws = false;
    process.env.ADMIN_EMAILS = "me@example.com";
  });

  it("says yes for a listed, confirmed admin — case-insensitively — and marks the answer uncacheable", async () => {
    authState.user = { email: "ME@example.com", email_confirmed_at: confirmed };
    const res = await GET();
    expect(await res.json()).toEqual({ isAdmin: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["a signed-in user who isn't listed", { email: "other@example.com", email_confirmed_at: confirmed }],
    ["a listed address that was never confirmed", { email: "me@example.com" }],
    ["nobody signed in", null],
  ])("says no for %s", async (_label, user) => {
    authState.user = user;
    expect(await (await GET()).json()).toEqual({ isAdmin: false });
  });

  it("says no — not an error — when nobody is configured as an admin", async () => {
    process.env.ADMIN_EMAILS = "";
    authState.user = { email: "me@example.com", email_confirmed_at: confirmed };
    expect(await (await GET()).json()).toEqual({ isAdmin: false });
  });

  it("fails closed when Supabase itself throws", async () => {
    authState.throws = true;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isAdmin: false });
  });

  it("never reveals the allow-list", async () => {
    authState.user = { email: "other@example.com", email_confirmed_at: confirmed };
    expect(JSON.stringify(await (await GET()).json())).not.toContain("me@example.com");
  });
});

describe("AdminUsageLink", () => {
  it("renders nothing on first paint — no flash of the link for anyone, admin or not, before the server has answered", async () => {
    const { AdminUsageLink } = await import("../components/AdminUsageLink");
    expect(renderToStaticMarkup(<AdminUsageLink />)).toBe("");
  });
});
