/** Brand and SEO constants, in one place so metadata, sitemap, manifest and JSON-LD agree. */
export const SITE_NAME = "CuriousArch";
export const SITE_TAGLINE = "Describe a system. See where it breaks. Try the fix.";
export const SITE_DESCRIPTION =
  "Describe a system in plain English and CuriousArch draws its architecture, shows where it breaks as traffic grows, and lets you try fixes before you build it.";
export const THEME_COLOR = "#0f172a";

/** Where privacy/legal questions go (shown on the legal pages). Set NEXT_PUBLIC_CONTACT_EMAIL in production. */
export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  return env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;
}

/** Bump when the privacy policy or terms change in substance. */
export const LEGAL_UPDATED = "28 September 2026";

/**
 * The public origin (no trailing slash), for canonical URLs, the sitemap and social cards. Set
 * NEXT_PUBLIC_SITE_URL in production (e.g. https://curiousarch.com); Vercel's own production URL is
 * the fallback so a preview deploy still produces working absolute links.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
