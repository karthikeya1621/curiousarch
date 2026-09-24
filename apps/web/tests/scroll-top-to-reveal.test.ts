import { describe, expect, it } from "vitest";
import { scrollTopToReveal } from "../lib/scrollTopToReveal";

// A 100px-tall window onto a long list of 30px rows.
const view = { viewHeight: 100, itemHeight: 30 };

describe("scrollTopToReveal", () => {
  it("leaves the scroll position alone when the item is already fully visible", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 60, itemTop: 90 })).toBe(60); // 90..120 inside 60..160
    expect(scrollTopToReveal({ ...view, scrollTop: 60, itemTop: 60 })).toBe(60); // flush with the top
    expect(scrollTopToReveal({ ...view, scrollTop: 60, itemTop: 130 })).toBe(60); // flush with the bottom
  });

  it("scrolls down just far enough to show an item below the fold", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 0, itemTop: 300 })).toBe(230); // its bottom (330) meets the window's bottom
  });

  it("scrolls up just far enough to show an item above the fold", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 500, itemTop: 120 })).toBe(120);
  });

  it("shows a partly-hidden item, at either edge", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 60, itemTop: 40 })).toBe(40); // clipped at the top
    expect(scrollTopToReveal({ ...view, scrollTop: 60, itemTop: 145 })).toBe(75); // clipped at the bottom
  });

  it("never scrolls to a negative position", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 50, itemTop: -10 })).toBe(0);
    expect(scrollTopToReveal({ viewHeight: 100, itemHeight: 30, scrollTop: 0, itemTop: 10 })).toBe(0);
  });

  it("handles an item taller than the window by showing its bottom", () => {
    expect(scrollTopToReveal({ viewHeight: 100, itemHeight: 250, scrollTop: 0, itemTop: 40 })).toBe(190);
  });
});
