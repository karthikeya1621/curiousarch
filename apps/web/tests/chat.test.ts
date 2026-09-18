/**
 * /api/chat against a mocked chatWithProject - no network, no API cost.
 * Mirrors infer.test.ts's pattern (fake the boundary, not the HTTP layer):
 * this only proves the route's request parsing/response shape are correct,
 * not that the LLM answers well.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@archsim/engine";

const chatWithProjectMock = vi.fn();
vi.mock("@archsim/engine/server", () => ({
  chatWithProject: (...args: unknown[]) => chatWithProjectMock(...args),
}));

beforeEach(() => {
  chatWithProjectMock.mockReset();
});

const { POST } = await import("../app/api/chat/route.ts");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  it("returns a plain answer for a question, with no model", async () => {
    chatWithProjectMock.mockResolvedValueOnce({
      isQuestion: true,
      reply: "The cache TTL is short because listings change often.",
      repaired: false,
    });

    const res = await POST(jsonRequest({ model: checkout, message: "why is the cache short-lived?" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isQuestion).toBe(true);
    expect(body.reply).toMatch(/short/i);
    expect(body.model).toBeUndefined();
    expect(chatWithProjectMock).toHaveBeenCalledWith(checkout, "why is the cache short-lived?");
  });

  it("returns the updated model for a change request", async () => {
    const updated = { ...checkout, name: "Checkout / order placement (updated)" };
    chatWithProjectMock.mockResolvedValueOnce({
      isQuestion: false,
      reply: "Adding a CDN in front of the gateway.",
      model: updated,
      repaired: false,
    });

    const res = await POST(jsonRequest({ model: checkout, message: "add a CDN" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isQuestion).toBe(false);
    expect(body.model.name).toBe(updated.name);
  });

  it("rejects a missing model with 400", async () => {
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(400);
    expect(chatWithProjectMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty message with 400", async () => {
    const res1 = await POST(jsonRequest({ model: checkout }));
    expect(res1.status).toBe(400);

    const res2 = await POST(jsonRequest({ model: checkout, message: "   " }));
    expect(res2.status).toBe(400);
    expect(chatWithProjectMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("surfaces a chatWithProject failure as a 502 with its message", async () => {
    chatWithProjectMock.mockRejectedValueOnce(new Error("structured output still failed validation"));

    const res = await POST(jsonRequest({ model: checkout, message: "add a CDN" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/still failed validation/i);
  });
});
