/**
 * The bits of a scrollable element this needs — a minimal shape so the rule
 * can be tested without a DOM.
 */
export interface ScrollableEnd {
  scrollHeight: number;
  scrollTo?: (options: { top: number; behavior: "smooth" | "auto" }) => void;
  scrollTop: number;
}

/**
 * Scrolls a container to its very end — the latest chat message. Smooth
 * normally, instant when the user has asked their OS for reduced motion.
 * Sets `scrollTop` directly where `scrollTo` isn't available, so it works in
 * every environment. Scrolls only this container (never the page around it,
 * which `scrollIntoView` on a child can do).
 */
export function scrollToEnd(el: ScrollableEnd | null | undefined, reducedMotion = false): void {
  if (!el) return;
  const top = el.scrollHeight;
  if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  else el.scrollTop = top;
}
