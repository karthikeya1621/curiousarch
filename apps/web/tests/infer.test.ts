/**
 * /api/infer against a mocked fromProse — no network, no API cost. Mirrors
 * packages/engine's own tests/fromProse.test.ts pattern (fake the boundary,
 * not the HTTP layer): this only proves the route's request parsing and
 * error handling are correct, not that the LLM produces a good model.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";
import { MAX_DESCRIPTION_LENGTH } from "../lib/limits";

const fromProseMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  fromProse: (...args: unknown[]) => fromProseMock(...args),
}));

beforeEach(() => {
  fromProseMock.mockReset();
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
  it("returns the inferred model on success", async () => {
    fromProseMock.mockResolvedValueOnce({ model: checkout, raw: {}, repaired: false });

    const res = await POST(jsonRequest({ description: "a checkout system" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model.id).toBe(checkout.id);
    expect(fromProseMock).toHaveBeenCalledWith("a checkout system");
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

  it("surfaces a fromProse failure as a 502 with its message", async () => {
    fromProseMock.mockRejectedValueOnce(new Error("model output still failed validation"));

    const res = await POST(jsonRequest({ description: "a system" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/still failed validation/i);
  });
});
