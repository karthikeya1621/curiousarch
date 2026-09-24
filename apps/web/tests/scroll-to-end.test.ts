import { describe, expect, it, vi } from "vitest";
import { scrollToEnd } from "../lib/scrollToEnd";

describe("scrollToEnd", () => {
  it("scrolls the container to its full height, smoothly", () => {
    const scrollTo = vi.fn();
    scrollToEnd({ scrollHeight: 900, scrollTop: 0, scrollTo });
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "smooth" });
  });

  it("jumps instead of animating when the user prefers reduced motion", () => {
    const scrollTo = vi.fn();
    scrollToEnd({ scrollHeight: 900, scrollTop: 0, scrollTo }, true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
  });

  it("falls back to setting scrollTop where scrollTo doesn't exist", () => {
    const el = { scrollHeight: 640, scrollTop: 0 };
    scrollToEnd(el);
    expect(el.scrollTop).toBe(640);
  });

  it("does nothing without an element (not mounted yet)", () => {
    expect(() => scrollToEnd(null)).not.toThrow();
    expect(() => scrollToEnd(undefined)).not.toThrow();
  });
});
