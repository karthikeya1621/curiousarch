/**
 * The accessibility contract of the shared pieces, checked on the server-rendered markup (no browser here): the
 * modal is a named dialog, the confirm dialog is an alertdialog, the failure badge has an accessible name and dark text
 * on amber, and the trial banner's live region exists before its content does.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiFinding } from "@archsim/engine";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FailureIndicator } from "../components/FailureIndicator";
import { GuestBanner } from "../components/GuestBanner";

const finding = (id: string) => ({ componentId: "db", code: id, title: id, severity: "critical" }) as unknown as AiFinding;

describe("Modal", () => {
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<Modal open={false} onClose={() => {}}>x</Modal>)).toBe("");
  });

  it("is a modal dialog named by its title, and can be focused as a fallback", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => {}} labelledBy="t1">
        <h2 id="t1">Title</h2>
      </Modal>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t1"');
    expect(html).toContain('tabindex="-1"');
  });

  it("falls back to aria-label when no title element is given", () => {
    const html = renderToStaticMarkup(<Modal open onClose={() => {}} ariaLabel="Details">x</Modal>);
    expect(html).toContain('aria-label="Details"');
  });
});

describe("ConfirmDialog", () => {
  it("is a single alertdialog with its title and message wired up (no nested duplicate role)", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="Delete?" message="This cannot be undone." onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html.match(/role="alertdialog"/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="confirm-dialog-title"');
    expect(html).toContain('aria-describedby="confirm-dialog-message"');
  });
});

describe("FailureIndicator", () => {
  it("names the badge, says whether it is expanded, and uses dark text on amber", () => {
    const html = renderToStaticMarkup(<FailureIndicator nodeId="db" findings={[finding("a"), finding("b")]} />);
    expect(html).toContain('aria-label="2 possible failures on db"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("text-slate-900");
    expect(html).not.toContain("text-white");
  });

  it("uses the singular for one finding, and draws nothing for none", () => {
    expect(renderToStaticMarkup(<FailureIndicator nodeId="db" findings={[finding("a")]} />)).toContain("1 possible failure on db");
    expect(renderToStaticMarkup(<FailureIndicator nodeId="db" findings={[]} />)).toBe("");
  });
});

describe("GuestBanner", () => {
  it("keeps its live region mounted before there is anything to announce", () => {
    const html = renderToStaticMarkup(<GuestBanner />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("Free trial");
    expect(html).not.toContain("Free plan");
  });
});

describe("AutoSaveIndicator source (structural, not rendered)", () => {
  // The "Save failed - retry" control's error state lives behind an internal useState this test cannot
  // reach without committing an effect (renderToStaticMarkup never does, and this repo has no jsdom/
  // testing-library to `act()` one) - so this checks the one thing that actually went wrong instead: an
  // explicit ARIA role overrides a host element's native one, and `role="alert"` was once placed directly
  // on the retry <button>, silently stripping its button semantics for assistive tech (announced as inert
  // alert text, not as something actionable). The fix moved the role onto a wrapping, non-interactive
  // element. A source-text check is a blunt instrument, but it is the one that can run at all here, and it
  // targets exactly the pattern that broke - see docs/orchestration (production-readiness review, run 2).
  it("never puts role=\"alert\" directly on the retry <button>", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../components/AutoSaveIndicator.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/<button[^>]*role=["']alert["']/);
    expect(src).toMatch(/role=["']alert["']/); // the role still exists, just not on the button itself
  });
});
