/**
 * `chatWithProject` against a fake Anthropic client - no network, no API
 * cost. Exactly ONE call now, question or change: a change request is
 * queued by the caller (the model isn't rewritten here), so what matters
 * is that the call returns a usable self-contained instruction and that
 * everything the AI needs to write one — queued fixes, queued changes,
 * the conversation — actually reaches it.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { chatWithProject } from "../src/inference/chatWithProject.js";
import { checkout } from "../models/reference.js";

function toolUseResponse(name: string, input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name, input }],
  } as unknown as Anthropic.Message;
}

function fakeClient(
  responses: Anthropic.Message[],
  onCreate?: (params: Anthropic.MessageCreateParams) => void,
): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        onCreate?.(params);
        const response = responses[call];
        call++;
        if (!response) throw new Error("fakeClient: no more canned responses");
        return response;
      },
    },
  } as unknown as Anthropic;
}

const questionRoute = {
  isQuestion: true,
  reply: "The cache has a short TTL because showtime availability changes frequently.",
  instruction: "",
};

const changeRoute = {
  isQuestion: false,
  reply: "Adding a CDN in front of the API Gateway.",
  instruction: 'Add a CDN component between the client and the API Gateway "gw" to serve static assets.',
};

const noFindings: never[] = [];
const noPendingFixes: never[] = [];
const noPendingChanges: never[] = [];

function systemText(params: Anthropic.MessageCreateParams): string {
  return Array.isArray(params.system) ? params.system.map((s) => s.text).join("") : (params.system ?? "");
}

describe("chatWithProject", () => {
  it("answers a question directly, with nothing to queue", async () => {
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)]);
    const result = await chatWithProject(
      checkout,
      "why is the cache TTL short?",
      [],
      noFindings,
      noPendingFixes,
      noPendingChanges,
      { client },
    );

    expect(result.isQuestion).toBe(true);
    expect(result.reply).toMatch(/short TTL/i);
    expect(result.instruction).toBeUndefined();
  });

  it("turns a change request into a queueable instruction — in ONE call, without rewriting the model", async () => {
    let calls = 0;
    const client = fakeClient([toolUseResponse("route_chat_message", changeRoute)], () => calls++);
    const result = await chatWithProject(
      checkout,
      "add a CDN in front of the gateway",
      [],
      noFindings,
      noPendingFixes,
      noPendingChanges,
      { client },
    );

    expect(result.isQuestion).toBe(false);
    expect(result.reply).toMatch(/CDN/i);
    expect(result.instruction).toBe(changeRoute.instruction);
    expect(calls).toBe(1);
    expect("model" in result).toBe(false);
  });

  it("falls back to the user's own words if the AI leaves the instruction blank", async () => {
    const client = fakeClient([toolUseResponse("route_chat_message", { ...changeRoute, instruction: "   " })]);
    const result = await chatWithProject(
      checkout,
      "add a CDN in front of the gateway",
      [],
      noFindings,
      noPendingFixes,
      noPendingChanges,
      { client },
    );

    expect(result.instruction).toBe("add a CDN in front of the gateway");
  });

  it("includes findings, queued fixes AND queued changes as context — marked as not yet in the model", async () => {
    const findings = [
      {
        code: "SINGLE_POINT_OF_FAILURE",
        severity: "critical" as const,
        componentId: "svc",
        title: "Single instance",
        explanation: "The order service runs as a single instance.",
        fixes: [],
      },
    ];
    const pendingFixes = [
      { componentId: "svc", findingTitle: "Single instance", fixLabel: "Add a second instance", fixTradeoff: "More cost." },
    ];
    const pendingChanges = [
      { request: "add a CDN in front of the gateway", instruction: 'Add a CDN before "gw".' },
    ];
    const seenSystemPrompts: string[] = [];
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)], (params) =>
      seenSystemPrompts.push(systemText(params)),
    );

    await chatWithProject(checkout, "why is this risky?", [], findings, pendingFixes, pendingChanges, { client });

    expect(seenSystemPrompts[0]).toMatch(/Single instance/);
    expect(seenSystemPrompts[0]).toMatch(/Add a second instance/);
    // Both the user's words and the self-contained instruction are shown.
    expect(seenSystemPrompts[0]).toMatch(/add a CDN in front of the gateway/);
    expect(seenSystemPrompts[0]).toMatch(/Add a CDN before "gw"/);
    expect(seenSystemPrompts[0]).toMatch(/NOT in that model yet/);
  });

  it("forwards prior conversation turns, followed by the new user turn", async () => {
    const history: Anthropic.MessageParam[] = [
      { role: "user", content: "why is the cache TTL short?" },
      { role: "assistant", content: "Because showtime availability changes frequently." },
    ];
    const seenMessages: Anthropic.MessageParam[][] = [];
    const client = fakeClient([toolUseResponse("route_chat_message", changeRoute)], (params) =>
      seenMessages.push(params.messages),
    );

    await chatWithProject(checkout, "make it long-lived instead", history, noFindings, noPendingFixes, noPendingChanges, {
      client,
    });

    expect(seenMessages).toHaveLength(1);
    expect(seenMessages[0]![0]).toEqual(history[0]);
    expect(seenMessages[0]![1]).toEqual(history[1]);
    expect(seenMessages[0]![2]?.role).toBe("user");
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(chatWithProject(checkout, "why?")).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
