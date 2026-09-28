/**
 * The routes honour the guest gate: a refused guest never reaches the engine, a failed engine call
 * releases the attempt, and validation errors never touch the quota.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const fromProse = vi.fn();
vi.mock("@archsim/engine/server", () => ({ fromProse: (...a: unknown[]) => fromProse(...a) }));
vi.mock("../lib/usage/server", () => ({ startUsage: async () => ({}) }));
const gate = vi.hoisted(() => ({ denied: undefined as unknown, release: vi.fn(), reserve: vi.fn() }));
vi.mock("../lib/trial/server", () => ({
  reserveTrial: async (...args: unknown[]) => {
    gate.reserve(...args);
    return { denied: gate.denied, release: gate.release };
  },
}));

const { POST } = await import("../app/api/infer/route.ts");
const post = (body: unknown) =>
  POST(new Request("http://x/api/infer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  fromProse.mockReset();
  gate.release.mockReset();
  gate.reserve.mockReset();
  gate.denied = undefined;
});

describe("POST /api/infer with the guest gate", () => {
  it("reserves a 'build' before running the engine", async () => {
    fromProse.mockResolvedValue({ model: { ok: true } });
    const res = await post({ description: "a shop" });
    expect(res.status).toBe(200);
    expect(gate.reserve.mock.calls[0]![2]).toBe("build");
    expect(gate.release).not.toHaveBeenCalled();
  });

  it("returns the refusal and never calls the engine", async () => {
    gate.denied = NextResponse.json({ code: "trial-limit" }, { status: 429 });
    const res = await post({ description: "a shop" });
    expect(res.status).toBe(429);
    expect(fromProse).not.toHaveBeenCalled();
  });

  it("releases the attempt when the engine fails", async () => {
    fromProse.mockRejectedValue(new Error("provider down"));
    const res = await post({ description: "a shop" });
    expect(res.status).toBe(502);
    expect(gate.release).toHaveBeenCalledOnce();
  });

  it("does not touch the quota for an invalid request", async () => {
    const res = await post({ description: "" });
    expect(res.status).toBe(400);
    expect(gate.reserve).not.toHaveBeenCalled();
  });
});
