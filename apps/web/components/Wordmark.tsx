/**
 * The app name: "Curious" light, "Arch" bold, in the brand font (Space Grotesk) - the only place that
 * font is used, so the name reads as a logo and not as more text. One component so the header and
 * login page match.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontFamily: "var(--font-brand), var(--font-sans), sans-serif", letterSpacing: "-0.02em" }}>
      <span className="font-light">Curious</span>
      <span className="font-bold">Arch</span>
    </span>
  );
}
