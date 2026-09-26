/**
 * /api/infer against a mocked fromProse — no network, no API cost. Mirrors
 * packages/engine's own tests/fromProse.test.ts pattern (fake the boundary,
 * not the HTTP layer): this only proves the route's request parsing and
 * error handling are correct, not that the LLM produces a good model.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";
import { MAX_DESCRIPTION_LENGTH, MAX_REQUEST_BYTES } from "../lib/limits";

const fromProseMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  fromProse: (...args: unknown[]) => fromProseMock(...args),
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
  fromProseMock.mockReset();
  usage.start.mockReset();
});

const { POST } = await import("../app/api/infer/route.ts");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/infer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/infer", () => {
  it("tracks the call as a build, labelled with the client's action id", async () => {
    fromProseMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });
    const actionId = "6f1c9d7e-2b1a-4c1e-9a55-0d3f5b7a1e21";

    await POST(jsonRequest({ description: "a checkout system", actionId }));

    expect(usage.start).toHaveBeenCalledWith(
      expect.objectContaining({ actionId }),
      expect.objectContaining({ action: "build", context: { descriptionChars: 17 } }),
    );
  });

  it("returns the inferred model on success", async () => {
    fromProseMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });

    const res = await POST(jsonRequest({ description: "a checkout system" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model.id).toBe(checkout.id);
    expect(fromProseMock).toHaveBeenCalledWith("a checkout system", usage.options);
  });

  it("rejects a missing description with 400", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(fromProseMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string description with 400", async () => {
    const res = await POST(jsonRequest({ description: 42 }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty description with 400", async () => {
    const res = await POST(jsonRequest({ description: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects a description longer than MAX_DESCRIPTION_LENGTH with 400, without calling fromProse", async () => {
    const res = await POST(jsonRequest({ description: "a".repeat(MAX_DESCRIPTION_LENGTH + 1) }));
    expect(res.status).toBe(400);
    expect(fromProseMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/infer", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a request whose content-length exceeds MAX_REQUEST_BYTES with 413, without parsing the body", async () => {
    const res = await POST(
      new Request("http://localhost/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify({ description: "a system" }),
      }),
    );
    expect(res.status).toBe(413);
    expect(fromProseMock).not.toHaveBeenCalled();
  });

  it("turns an fromProse failure into a friendly 502 — the raw engine message is kept out of the customer-facing error (outside production it is in `detail`)", async () => {
    fromProseMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest({ description: "a system" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Your project is unchanged/);
    expect(body.error).not.toMatch(/still failed validation/i);
    expect(body.detail).toMatch(/still failed validation/i);
  });

  it("a build the engine's final gate refused is a 422 with the same fixed message", async () => {
    fromProseMock.mockRejectedValueOnce(Object.assign(new Error("The result broke 1 rule"), { name: "ModelGateError" }));

    const res = await POST(jsonRequest({ description: "a system" }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsafe-result");
  });
});
