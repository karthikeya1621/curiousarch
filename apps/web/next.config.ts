import path from "node:path";
import type { NextConfig } from "next";

// Baseline security headers for every response. A Content-Security-Policy is deliberately NOT set yet:
// it needs a nonce for Next's inline scripts plus allowances for Google Sign-In and hCaptcha, and a
// wrong one breaks login silently - a follow-up to design and test in a browser (see docs/DEPLOYMENT.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Browsers ignore HSTS over plain http, so this is inert on localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    // Explicit, not inferred — Turbopack's monorepo root-detection heuristic
    // has open issues reported against pnpm workspaces; untested for npm
    // workspaces, so don't rely on it guessing right here. (Not the cause of
    // the real resolution bug found in this package — see
    // packages/engine/src/index.ts's doc comment — but still worth pinning
    // explicitly per the research that flagged it as a risk.)
    root: path.join(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
