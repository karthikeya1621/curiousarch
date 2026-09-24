/**
 * The smallest scroll position that brings an item fully into view inside a
 * scrolling container — unchanged if it's already visible, so a list the user
 * is browsing isn't yanked around. Plain numbers so it's testable without a
 * DOM.
 *
 * `itemTop` is the item's offset from the top of the container's SCROLLABLE
 * CONTENT (an element's `offsetTop` inside a positioned container), not from
 * the viewport.
 */
export function scrollTopToReveal(input: {
  scrollTop: number;
  viewHeight: number;
  itemTop: number;
  itemHeight: number;
}): number {
  const { scrollTop, viewHeight, itemTop, itemHeight } = input;
  if (itemTop < scrollTop) return Math.max(0, itemTop); // above the fold: bring its top to the top
  const itemBottom = itemTop + itemHeight;
  if (itemBottom > scrollTop + viewHeight) return Math.max(0, itemBottom - viewHeight); // below: bring its bottom to the bottom
  return scrollTop;
}
