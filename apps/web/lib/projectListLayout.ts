/**
 * The projects list shows a fixed number of rows and scrolls for the rest —
 * three and a HALF, so the half-visible fourth row is itself the cue that
 * there's more below. That only reads as half if every row is the same known
 * height, so the row height and gap are constants used for BOTH the rows and
 * the cap, rather than a cap guessed in pixels that drifts the moment a row's
 * padding or font size changes.
 */
export const PROJECT_ROW_REM = 2.25;
export const PROJECT_ROW_GAP_REM = 0.125;
export const PROJECT_LIST_VISIBLE_ROWS = 3.5;

/** The height (rem) of a list showing `visibleRows` rows, gaps included. */
export function projectListMaxHeightRem(
  visibleRows: number = PROJECT_LIST_VISIBLE_ROWS,
  rowRem: number = PROJECT_ROW_REM,
  gapRem: number = PROJECT_ROW_GAP_REM,
): number {
  // Only the gaps BETWEEN visible rows count: a half-shown last row has no gap under it yet.
  const gaps = Math.max(0, Math.ceil(visibleRows) - 1);
  return visibleRows * rowRem + gaps * gapRem;
}
