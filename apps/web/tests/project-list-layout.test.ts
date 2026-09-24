import { describe, expect, it } from "vitest";
import {
  PROJECT_LIST_VISIBLE_ROWS,
  PROJECT_ROW_GAP_REM,
  PROJECT_ROW_REM,
  projectListMaxHeightRem,
} from "../lib/projectListLayout";

describe("projectListMaxHeightRem", () => {
  it("shows exactly three and a half rows by default: 3.5 row heights plus the 3 gaps between the rows it shows", () => {
    expect(PROJECT_LIST_VISIBLE_ROWS).toBe(3.5);
    // 3.5 * 2.25 + 3 * 0.125
    expect(projectListMaxHeightRem()).toBeCloseTo(3.5 * PROJECT_ROW_REM + 3 * PROJECT_ROW_GAP_REM, 10);
    expect(projectListMaxHeightRem()).toBeCloseTo(8.25, 10);
  });

  it("leaves the fourth row exactly half showing", () => {
    const height = projectListMaxHeightRem();
    const threeRows = 3 * PROJECT_ROW_REM + 3 * PROJECT_ROW_GAP_REM; // three rows + the gap after the third
    expect((height - threeRows) / PROJECT_ROW_REM).toBeCloseTo(0.5, 10);
  });

  it("scales with the row height it's given, not a baked-in number", () => {
    expect(projectListMaxHeightRem(3.5, 3, 0)).toBeCloseTo(10.5, 10);
  });

  it("counts gaps only between the rows shown, and none for a single row", () => {
    expect(projectListMaxHeightRem(1, 2, 1)).toBe(2);
    expect(projectListMaxHeightRem(2, 2, 1)).toBe(5); // two rows + one gap
  });
});
