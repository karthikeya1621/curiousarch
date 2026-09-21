/**
 * /api/chat against a mocked chatWithProject - no network, no API cost.
 * Mirrors infer.test.ts's pattern (fake the boundary, not the HTTP layer):
 * this only proves the route's request parsing/response shape are correct,
 * not that the LLM answers well.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkout, MAX_TOTAL_COMPONENTS } from "@archsim/engine";
import { MAX_CHAT_MESSAGE_LENGTH, MAX_REQUEST_BYTES } from "../lib/limits";

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
    // No `history`/`findings`/`pendingFixes` sent — each defaults to an
    // empty array, not undefined.
    expect(chatWithProjectMock).toHaveBeenCalledWith(checkout, "why is the cache short-lived?", [], [], []);
  });

  it("forwards a provided history array to chatWithProject", async () => {
    chatWithProjectMock.mockResolvedValueOnce({ isQuestion: true, reply: "Because it's a hot key.", repaired: false });
    const history = [
      { role: "user", content: "why is the cache TTL short?" },
      { role: "assistant", content: "Because it's a hot key." },
    ];

    await POST(jsonRequest({ model: checkout, message: "what about the database?", history }));

    expect(chatWithProjectMock).toHaveBeenCalledWith(checkout, "what about the database?", history, [], []);
  });

  it("forwards provided findings and pendingFixes to chatWithProject", async () => {
    chatWithProjectMock.mockResolvedValueOnce({ isQuestion: true, reply: "Because it's a single instance.", repaired: false });
    const findings = [
      {
        code: "SINGLE_POINT_OF_FAILURE",
        severity: "critical",
        componentId: "svc",
        title: "Single instance",
        explanation: "The order service runs as a single instance.",
        fixes: [],
      },
    ];
    const pendingFixes = [
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", fixTradeoff: "More cost." },
    ];

    await POST(jsonRequest({ model: checkout, message: "why is this risky?", findings, pendingFixes }));

    expect(chatWithProjectMock).toHaveBeenCalledWith(checkout, "why is this risky?", [], findings, pendingFixes);
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

  it("rejects a request whose content-length exceeds MAX_REQUEST_BYTES with 413, without parsing the body", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify({ model: checkout, message: "hi" }),
      }),
    );
    expect(res.status).toBe(413);
    expect(chatWithProjectMock).not.toHaveBeenCalled();
  });

  it("rejects a model with more components than MAX_TOTAL_COMPONENTS with 400 — a hand-crafted payload bypassing the AI's own generation caps", async () => {
    const oversized = {
      ...checkout,
      components: Array.from({ length: MAX_TOTAL_COMPONENTS + 1 }, (_, i) => ({ ...checkout.components[0], id: `c${i}` })),
    };

    const res = await POST(jsonRequest({ model: oversized, message: "hi" }));
    expect(res.status).toBe(400);
    expect(chatWithProjectMock).not.toHaveBeenCalled();
  });

  it("rejects a message longer than MAX_CHAT_MESSAGE_LENGTH with 400", async () => {
    const res = await POST(jsonRequest({ model: checkout, message: "a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1) }));
    expect(res.status).toBe(400);
    expect(chatWithProjectMock).not.toHaveBeenCalled();
  });

  it("surfaces a chatWithProject failure as a 502 with its message", async () => {
    chatWithProjectMock.mockRejectedValueOnce(new Error("structured output still failed validation"));

    const res = await POST(jsonRequest({ model: checkout, message: "add a CDN" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/still failed validation/i);
  });
});
