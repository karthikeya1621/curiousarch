/**
 * /api/identify-failures against a mocked identifyFailures - no network, no
 * API cost. Mirrors infer.test.ts's pattern (fake the boundary, not the
 * HTTP layer). Previously had no test coverage at all; added alongside the
 * security-review fix that gave this route its first input validation
 * (see lib/limits.ts's own comment on why).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout, MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import { MAX_REQUEST_BYTES } from "../lib/limits";

const identifyFailuresMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  identifyFailures: (...args: unknown[]) => identifyFailuresMock(...args),
}));

beforeEach(() => {
  identifyFailuresMock.mockReset();
});

const { POST } = await import("../app/api/identify-failures/route.ts");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/identify-failures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/identify-failures", () => {
  it("returns findings on success", async () => {
    identifyFailuresMock.mockResolvedValueOnce([
      { code: "SINGLE_POINT_OF_FAILURE", severity: "critical", componentId: "svc", title: "Single instance", explanation: "...", fixes: [] },
    ]);

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings).toHaveLength(1);
    expect(identifyFailuresMock).toHaveBeenCalledWith(checkout);
  });

  it("rejects a missing model with 400", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(identifyFailuresMock).not.toHaveBeenCalled();
  });

  it("rejects a model with more components than MAX_TOTAL_COMPONENTS with 400", async () => {
    const oversized = {
      ...checkout,
      components: Array.from({ length: MAX_TOTAL_COMPONENTS + 1 }, (_, i) => ({ ...checkout.components[0], id: `c${i}` })),
    };

    const res = await POST(jsonRequest({ model: oversized }));
    expect(res.status).toBe(400);
    expect(identifyFailuresMock).not.toHaveBeenCalled();
  });

  it("rejects a model whose components/edges aren't arrays with 400", async () => {
    const res = await POST(jsonRequest({ model: { ...checkout, components: "not an array" } }));
    expect(res.status).toBe(400);
    expect(identifyFailuresMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose content-length exceeds MAX_REQUEST_BYTES with 413, without parsing the body", async () => {
    const res = await POST(
      new Request("http://localhost/api/identify-failures", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify({ model: checkout }),
      }),
    );
    expect(res.status).toBe(413);
    expect(identifyFailuresMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(new Request("http://localhost/api/identify-failures", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("surfaces an identifyFailures failure as a 502 with its message", async () => {
    identifyFailuresMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/still failed validation/i);
  });
});
