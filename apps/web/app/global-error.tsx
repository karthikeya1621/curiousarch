"use client";

/**
 * Last resort: replaces the root layout when even that throws, so it brings its own <html>/<body> and inline
 * styles (no Tailwind, no theme script). Follows the OS colour scheme, as the built-in page does.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 16px", opacity: 0.75, fontSize: 14 }}>
            CuriousArch hit an unexpected problem. Your work is saved automatically, so trying again is safe.
          </p>
          {error.digest && <p style={{ margin: "0 0 16px", opacity: 0.6, fontSize: 12 }}>Reference: {error.digest}</p>}
          <button
            onClick={() => retry()}
            style={{ padding: "8px 16px", fontSize: 14, borderRadius: 8, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
