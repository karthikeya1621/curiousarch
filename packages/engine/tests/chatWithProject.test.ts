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

  // Found live: an answer came back as a multi-paragraph, markdown-formatted
  // essay (bold headers, a numbered list) — the chat bubble has no markdown
  // renderer at all, so it showed up as literal asterisks and "1./2./3."
  // text, and was long enough to need its own scroll fix in the UI. This is
  // the prompt-level half of that fix.
  it("tells the model its reply is a spoken chat bubble with no markdown support, kept short", async () => {
    let systemPrompt = "";
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)], (params) => {
      systemPrompt = systemText(params);
    });

    await chatWithProject(checkout, "why?", [], noFindings, noPendingFixes, noPendingChanges, { client });

    expect(systemPrompt).toMatch(/no markdown/i);
    expect(systemPrompt).toMatch(/numbered or bulleted list/i);
    expect(systemPrompt.toLowerCase()).toContain("2-4 sentences");
  });

  // Found live: asked "analyze the flow" right after a chat-queued change
  // had already been Re-simulated (but the rework silently failed to add
  // what was requested — a real, separate bug), the model answered "I need
  // to see the updated model first... can you re-simulate" — treating the
  // model it was ALREADY given as not-yet-current, because an earlier turn
  // in the same conversation had said something was being added that isn't
  // actually there. It should trust the model it's given over anything said
  // earlier, and never claim reviewing the CURRENT system needs Re-simulate
  // (only a change does).
  it("tells the model that reviewing the current system never needs Re-simulate, and to trust the given model over anything said earlier", async () => {
    let systemPrompt = "";
    const client = fakeClient([toolUseResponse("route_chat_message", questionRoute)], (params) => {
      systemPrompt = systemText(params);
    });

    await chatWithProject(checkout, "analyze the flow for improvements", [], noFindings, noPendingFixes, noPendingChanges, {
      client,
    });

    expect(systemPrompt).toMatch(/ever waiting on a Re-simulate/i);
    expect(systemPrompt).toMatch(/trust the model below/i);
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

describe("route prompt", () => {
  it("treats a change that can't be made as a question, so a no-op is never queued", async () => {
    let system = "";
    const client = {
      messages: {
        create: async (params: { system: unknown }) => {
          system = JSON.stringify(params.system);
          return { content: [{ type: "tool_use", id: "c", name: "route_chat_message", input: { isQuestion: true, reply: "r", instruction: "" } }] };
        },
      },
    } as unknown as import("@anthropic-ai/sdk").default;
    await chatWithProject({ id: "m", name: "m", workload: {}, components: [], edges: [] } as never, "Remove the cache.", [], [], [], [], { client });
    expect(system).toMatch(/ALREADY TRUE[\s\S]*is NOT a change[\s\S]*treat it as a QUESTION/);
  });
});

describe("a reply that asks a question is never queued as a change", () => {
  const client = (reply: string) =>
    ({
      messages: {
        create: async () => ({
          content: [{ type: "tool_use", id: "c", name: "route_chat_message", input: { isQuestion: false, reply, instruction: "Add a queue." } }],
        }),
      },
    }) as unknown as Anthropic;

  it("treats a change flagged with a clarifying question as a question (nothing to queue)", async () => {
    const result = await chatWithProject(checkout, "Add a queue.", [], [], [], [], {
      client: client("You already have a queue between them. Did you mean a second one?"),
    });
    expect(result.isQuestion).toBe(true);
    expect(result.instruction).toBeUndefined();
  });

  it("still queues an ordinary change statement", async () => {
    const result = await chatWithProject(checkout, "Add a queue.", [], [], [], [], {
      client: client("Adding a queue between the order service and the database."),
    });
    expect(result.isQuestion).toBe(false);
    expect(result.instruction).toBe("Add a queue.");
  });
});

describe("route prompt kinds", () => {
  it("lists every valid component kind, so the restated instruction never invents one (\"storage\", \"message-queue\")", async () => {
    let system = "";
    const client = {
      messages: {
        create: async (params: { system: unknown }) => {
          system = JSON.stringify(params.system);
          return { content: [{ type: "tool_use", id: "c", name: "route_chat_message", input: { isQuestion: true, reply: "r", instruction: "" } }] };
        },
      },
    } as unknown as Anthropic;
    await chatWithProject(checkout, "Add storage.", [], [], [], [], { client });
    for (const kind of ["gateway", "service", "cache", "database", "queue", "object-storage", "message-broker", "cdn", "external-dependency"]) {
      expect(system).toContain(kind);
    }
    expect(system).toMatch(/never a made-up one/);
  });
});
