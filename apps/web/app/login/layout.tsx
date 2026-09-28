import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../../lib/site";

/**
 * /login is the one page a visitor (or a search engine) can open without a session, so it is the
 * public front door: indexable, with its own title/description, a canonical URL and structured data.
 * (The root layout marks everything else noindex.)
 */
export const metadata: Metadata = {
  title: "Sign in",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/login" },
  robots: { index: true, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: `${siteUrl()}/login`,
    description: SITE_DESCRIPTION,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {children}
    </>
  );
}
