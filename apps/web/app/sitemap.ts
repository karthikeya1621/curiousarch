import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

/** One public page today (everything else needs a login). Add marketing pages here as they exist. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl()}/login`, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl()}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl()}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
