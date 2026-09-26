import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server rendering reads a zustand store's INITIAL state, so the store is replaced by a
// selector over a state this test controls.
const state: { reworkWarning: unknown; dismissReworkWarning: () => void } = { reworkWarning: null, dismissReworkWarning: () => {} };
vi.mock("../lib/store", () => ({ useAppStore: (select: (s: typeof state) => unknown) => select(state) }));

describe("ReworkWarning", () => {
  it("renders nothing without a warning, and names what was removed when there is one", async () => {
    const { ReworkWarning } = await import("../components/ReworkWarning");
    state.reworkWarning = null;
    expect(renderToStaticMarkup(<ReworkWarning />)).toBe("");
    state.reworkWarning = { removed: [{ id: "cdn", label: "Video CDN", kind: "cdn" }, { id: "job", label: "Nightly Job", kind: "scheduled-job" }] };
    const html = renderToStaticMarkup(<ReworkWarning />);
    expect(html).toContain("removed 2 components you didn&#x27;t");
    expect(html).toContain("Video CDN, Nightly Job");
    expect(html).toContain("Version History");
    expect(html).toContain('role="alert"');
  });

  it("says 'a component' for one", async () => {
    const { ReworkWarning } = await import("../components/ReworkWarning");
    state.reworkWarning = { removed: [{ id: "cdn", label: "Video CDN", kind: "cdn" }] };
    expect(renderToStaticMarkup(<ReworkWarning />)).toContain("removed a component you didn&#x27;t");
  });
});
