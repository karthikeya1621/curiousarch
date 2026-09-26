/**
 * /api/explain-fix against a mocked explainFix - no network, no API cost.
 * Mirrors infer.test.ts's pattern. Previously had no test coverage at all;
 * added alongside the security-review fix that gave this route its first
 * input validation on `model` (see lib/limits.ts's own comment on why).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout, MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import { MAX_REQUEST_BYTES } from "../lib/limits";

const explainFixMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  explainFix: (...args: unknown[]) => explainFixMock(...args),
}));

// Usage tracking is its own concern (lib/usage/, tested there): here it's a
// stub that hands the engine call a recognizable options object, so each
// test can assert the route both started tracking and passed it on.
const usage = vi.hoisted(() => ({ options: { onCall: () => {} }, start: vi.fn() }));
vi.mock("../lib/usage/server", () => ({
  startUsage: (...args: unknown[]) => {
    usage.start(...args);
    return Promise.resolve(usage.options);
  },
}));

beforeEach(() => {
  explainFixMock.mockReset();
  usage.start.mockReset();
});

const { POST } = await import("../app/api/explain-fix/route.ts");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/explain-fix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  model: checkout,
  componentId: "svc",
  fixLabel: "Add a second instance",
  findingCode: "SINGLE_POINT_OF_FAILURE",
};

describe("POST /api/explain-fix", () => {
  it("tracks the call as explain-fix, with the model's shape as context", async () => {
    explainFixMock.mockResolvedValueOnce({ rationale: "because" });

    await POST(jsonRequest({ model: checkout, componentId: "svc", fixLabel: "Add a second instance", findingCode: "X" }));

    expect(usage.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "explain-fix",
        context: expect.objectContaining({ components: checkout.components.length, findingCode: "X" }),
      }),
    );
  });

  it("returns the rationale on success", async () => {
    explainFixMock.mockResolvedValueOnce({ rationale: "This fits because...", repaired: false });

    const res = await POST(jsonRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rationale).toMatch(/This fits/);
    expect(explainFixMock).toHaveBeenCalledWith(checkout, "svc", "Add a second instance", "SINGLE_POINT_OF_FAILURE", usage.options);
  });

  it("rejects a missing model with 400", async () => {
    const { model: _model, ...rest } = validBody;
    const res = await POST(jsonRequest(rest));
    expect(res.status).toBe(400);
    expect(explainFixMock).not.toHaveBeenCalled();
  });

  it("rejects a missing componentId/fixLabel/findingCode with 400", async () => {
    const res = await POST(jsonRequest({ model: checkout, fixLabel: "x", findingCode: "y" }));
    expect(res.status).toBe(400);
    expect(explainFixMock).not.toHaveBeenCalled();
  });

  it("rejects a model with more components than MAX_TOTAL_COMPONENTS with 400", async () => {
    const oversized = {
      ...checkout,
      components: Array.from({ length: MAX_TOTAL_COMPONENTS + 1 }, (_, i) => ({ ...checkout.components[0], id: `c${i}` })),
    };

    const res = await POST(jsonRequest({ ...validBody, model: oversized }));
    expect(res.status).toBe(400);
    expect(explainFixMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose content-length exceeds MAX_REQUEST_BYTES with 413, without parsing the body", async () => {
    const res = await POST(
      new Request("http://localhost/api/explain-fix", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify(validBody),
      }),
    );
    expect(res.status).toBe(413);
    expect(explainFixMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(new Request("http://localhost/api/explain-fix", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("turns an explainFix failure into a friendly 502 — the raw engine message is kept out of the customer-facing error (outside production it is in `detail`)", async () => {
    explainFixMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest(validBody));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Your project is unchanged/);
    expect(body.error).not.toMatch(/still failed validation/i);
    expect(body.detail).toMatch(/still failed validation/i);
  });
});
