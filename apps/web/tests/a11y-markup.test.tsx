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
