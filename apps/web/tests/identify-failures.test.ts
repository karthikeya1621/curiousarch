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
  identifyFailuresMock.mockReset();
  usage.start.mockReset();
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
  it("tracks the call as findings, with the model's shape as context", async () => {
    identifyFailuresMock.mockResolvedValueOnce([]);

    await POST(jsonRequest({ model: checkout }));

    expect(usage.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "findings",
        context: expect.objectContaining({ components: checkout.components.length, edges: checkout.edges.length }),
      }),
    );
  });

  it("returns findings on success", async () => {
    identifyFailuresMock.mockResolvedValueOnce([
      { code: "SINGLE_POINT_OF_FAILURE", severity: "critical", componentId: "svc", title: "Single instance", explanation: "...", fixes: [] },
    ]);

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings).toHaveLength(1);
    expect(identifyFailuresMock).toHaveBeenCalledWith(checkout, usage.options);
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

  it("turns an identifyFailures failure into a friendly 502 — the raw engine message is kept out of the customer-facing error (outside production it is in `detail`)", async () => {
    identifyFailuresMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Your project is unchanged/);
    expect(body.error).not.toMatch(/still failed validation/i);
    expect(body.detail).toMatch(/still failed validation/i);
  });
});
