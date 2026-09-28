/**
 * SEO/branding plumbing: the public origin resolution, and that the proxy leaves crawler files and the
 * health probe reachable without a login (a redirect on robots.txt hides the whole site).
 */
import { describe, expect, it } from "vitest";
import { contactEmail, siteUrl } from "../lib/site";
import { config } from "../proxy";

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL and strips trailing slashes", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://curiousarch.com//", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://curiousarch.com");
  });
  it("falls back to the Vercel production URL, then localhost", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://x.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("proxy matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it.each(["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/api/health", "/opengraph-image.png", "/icon.svg", "/apple-icon.png", "/_next/static/a.js"])(
    "does not gate %s",
    (path) => expect(re.test(path)).toBe(false),
  );
  it.each(["/", "/login", "/project/abc", "/api/infer", "/admin/usage", "/api/trial/status"])("still runs on %s", (path) => expect(re.test(path)).toBe(true));
});

describe("contactEmail", () => {
  it("is the trimmed env value, or null when unset/blank", () => {
    expect(contactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: " hi@x.io " })).toBe("hi@x.io");
    expect(contactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: "  " })).toBeNull();
    expect(contactEmail({})).toBeNull();
  });
});
