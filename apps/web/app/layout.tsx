import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, THEME_COLOR, siteUrl } from "../lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Brand font: the wordmark only (components/Wordmark.tsx). Content stays in Geist so the name reads as
// a logo, not as more text.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} - ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["system design", "architecture simulator", "capacity planning", "failure analysis", "scalability", "learn system design"],
  authors: [{ name: SITE_NAME }],
  openGraph: { type: "website", siteName: SITE_NAME, title: `${SITE_NAME} - ${SITE_TAGLINE}`, description: SITE_DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} - ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  // The app itself is behind login; only the pages that opt in (see app/login/layout.tsx) are indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
};

// Keep this key literally in sync with THEME_KEY in lib/theme.ts — this
// runs before any of our JS bundles load, so it can't import that
// constant, only duplicate it.
const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem("archsim:theme");
    var isDark =
      theme === "dark" ||
      ((theme === "system" || !theme) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // suppressHydrationWarning here too: the boot script below sets the
      // `dark` class before React hydrates, which would otherwise look
      // like a hydration mismatch on this exact element every time dark
      // mode (or "system" resolving to dark) is active.
      suppressHydrationWarning
      className={`${geistSans.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.)
          inject attributes like data-gr-ext-installed onto <body> before
          React hydrates - a real mismatch, but not one caused by our own
          code, and not one worth failing hydration over. Scoped to this
          one element only, so it won't hide a genuine mismatch elsewhere. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Runs before first paint — first child of <body>, executed
            synchronously during HTML parsing, well before hydration or
            any of our own bundles. Sets the `dark` class immediately so
            there's no flash of the wrong theme on load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
