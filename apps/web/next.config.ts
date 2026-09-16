import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
