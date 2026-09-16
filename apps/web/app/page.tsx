"use client";

import { useMemo } from "react";
import { simulate, checkout } from "@archsim/engine";

/**
 * PLAN-1.2 acceptance: simulate() runs in the browser, zero network call.
 * Unstyled JSON dump on purpose — no UI polish is this slice's job, just
 * proving the engine executes client-side. Open devtools Network tab: no
 * request fires for this computation.
 */
export default function Home() {
  const result = useMemo(() => simulate(checkout), []);

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>{checkout.name}</h1>
      <p>Computed client-side by simulate() — no network call.</p>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </main>
  );
}
