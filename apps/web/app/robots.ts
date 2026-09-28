import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

/** Only the public front door is crawlable; the app, API and admin never are. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/login", "/privacy", "/terms"], disallow: ["/api/", "/admin/", "/project/", "/auth/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
