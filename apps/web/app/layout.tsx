import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "archsim",
  description: "A what-if capacity simulator: describe a system, find its failure points, try a fix, see the delta.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.)
          inject attributes like data-gr-ext-installed onto <body> before
          React hydrates - a real mismatch, but not one caused by our own
          code, and not one worth failing hydration over. Scoped to this
          one element only, so it won't hide a genuine mismatch elsewhere. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
