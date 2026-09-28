/**
 * readJsonBody: the size guard measures the body that actually arrived, not the client's word for it.
 */
import { describe, expect, it } from "vitest";
import { readJsonBody } from "../lib/apiRoute";
import { MAX_REQUEST_BYTES } from "../lib/limits";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api/chat", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("readJsonBody", () => {
  it("parses a normal body", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({ body: { a: 1 } });
  });

  it("rejects an oversized body even when content-length is missing or understated", async () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_REQUEST_BYTES) });
    const noHeader = await readJsonBody(post(big));
    expect("error" in noHeader && noHeader.error.status).toBe(413);
    const lying = await readJsonBody(post(big, { "content-length": "10" }));
    expect("error" in lying && lying.error.status).toBe(413);
  });

  it("rejects an oversized declared length without reading the body", async () => {
    const res = await readJsonBody(post("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) }));
    expect("error" in res && res.error.status).toBe(413);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const res = await readJsonBody(post("not json"));
    expect("error" in res && res.error.status).toBe(400);
  });
});
