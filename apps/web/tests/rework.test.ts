/**
 * /api/rework against a mocked reworkModel - no network, no API cost.
 * Mirrors infer.test.ts's pattern. Previously had no test coverage at all;
 * added alongside the security-review fix that gave this route its first
 * input validation (see lib/limits.ts's own comment on why).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout, MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import { MAX_PENDING_CHANGES, MAX_REQUEST_BYTES } from "../lib/limits";

const reworkModelMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  reworkModel: (...args: unknown[]) => reworkModelMock(...args),
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
  reworkModelMock.mockReset();
  usage.start.mockReset();
});

const { POST } = await import("../app/api/rework/route.ts");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/rework", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rework", () => {
  it("tracks the call as a rework, recording how much was queued", async () => {
    reworkModelMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });

    await POST(
      jsonRequest({
        model: checkout,
        pendingFixes: [{ componentId: "svc", findingTitle: "t", fixLabel: "l", fixTradeoff: "x" }],
        pendingChanges: [{ request: "a", instruction: "b" }],
      }),
    );

    expect(usage.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "rework",
        context: expect.objectContaining({ pendingFixes: 1, pendingChanges: 1 }),
      }),
    );
  });

  it("returns the reworked model on success", async () => {
    reworkModelMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model.id).toBe(checkout.id);
    expect(reworkModelMock).toHaveBeenCalledWith(checkout, [], [], usage.options);
  });

  it("forwards a provided pendingFixes array to reworkModel", async () => {
    reworkModelMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });
    const pendingFixes = [
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", fixTradeoff: "More cost." },
    ];

    await POST(jsonRequest({ model: checkout, pendingFixes }));

    expect(reworkModelMock).toHaveBeenCalledWith(checkout, pendingFixes, [], usage.options);
  });

  it("forwards queued chat changes to reworkModel", async () => {
    reworkModelMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });
    const pendingChanges = [{ request: "add a CDN", instruction: 'Add a CDN before "gw".' }];

    await POST(jsonRequest({ model: checkout, pendingChanges }));

    expect(reworkModelMock).toHaveBeenCalledWith(checkout, [], pendingChanges, usage.options);
  });

  it("rejects an oversized or malformed pendingChanges with 400", async () => {
    const tooMany = Array.from({ length: MAX_PENDING_CHANGES + 1 }, () => ({ request: "a", instruction: "b" }));
    for (const pendingChanges of [tooMany, "nope", [{ request: 1, instruction: "b" }]]) {
      const res = await POST(jsonRequest({ model: checkout, pendingChanges }));
      expect(res.status).toBe(400);
    }
    expect(reworkModelMock).not.toHaveBeenCalled();
  });

  it("rejects a missing model with 400", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(reworkModelMock).not.toHaveBeenCalled();
  });

  it("rejects a model with more components than MAX_TOTAL_COMPONENTS with 400", async () => {
    const oversized = {
      ...checkout,
      components: Array.from({ length: MAX_TOTAL_COMPONENTS + 1 }, (_, i) => ({ ...checkout.components[0], id: `c${i}` })),
    };

    const res = await POST(jsonRequest({ model: oversized }));
    expect(res.status).toBe(400);
    expect(reworkModelMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose content-length exceeds MAX_REQUEST_BYTES with 413, without parsing the body", async () => {
    const res = await POST(
      new Request("http://localhost/api/rework", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify({ model: checkout }),
      }),
    );
    expect(res.status).toBe(413);
    expect(reworkModelMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(new Request("http://localhost/api/rework", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("turns an reworkModel failure into a friendly 502 — the raw engine message is kept out of the customer-facing error (outside production it is in `detail`)", async () => {
    reworkModelMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Your project is unchanged/);
    expect(body.error).not.toMatch(/still failed validation/i);
    expect(body.detail).toMatch(/still failed validation/i);
  });

  it("a result the engine's final gate refused is a 422 with a fixed message and a code the client can act on", async () => {
    const gate = Object.assign(new Error("The result broke 1 rule: x is not connected to anything"), { name: "ModelGateError", violations: ["x"] });
    reworkModelMock.mockRejectedValueOnce(gate);

    const res = await POST(jsonRequest({ model: checkout }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("unsafe-result");
    expect(body.error).toMatch(/nothing was changed/i);
    expect(JSON.stringify(body)).not.toMatch(/not connected to anything/);
  });
});
