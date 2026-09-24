/**
 * `fromProse` against a fake Anthropic client — no network, no API cost.
 *
 * This exercises the part that doesn't need a live model: the validate ->
 * repair-retry -> give-up state machine. The actual "does the LLM produce a
 * sane rough model" question still needs a live key; this only proves the
 * harness around it is correct.
 *
 * `fromProse` makes THREE calls now — topology and workloadParameters in
 * parallel, then extendedComponents sequentially after (see fromProse.ts's
 * own comment on why) — so the fake client here routes canned responses by
 * which tool is being called rather than a single shared sequential queue.
 * These tests are all about the TOPOLOGY call's retry behavior; the
 * workload-parameters and extended-components calls are always given one
 * simple valid response each so neither interferes with what's being
 * tested. `workloadParameters.test.ts`/`extendedComponents.test.ts` cover
 * those calls' own retry behavior independently.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fromProse } from "../src/inference/fromProse.js";
import { SYSTEM_PROMPT } from "../src/inference/prompt.js";

const validModelInput = {
  id: "toy",
  name: "Toy system",
  workload: {},
  components: [
    {
      id: "gw",
      label: "Gateway",
      kind: "gateway",
      hasRateLimiting: { rationale: "No limit stated; assumed default.", provenance: "default", value: false },
    },
    {
      id: "svc",
      label: "Service",
      kind: "service",
      instanceCount: { rationale: "Two instances stated.", provenance: "stated", value: "multiple" },
      hasCircuitBreaker: { rationale: "Default assumption.", provenance: "default", value: false },
    },
  ],
  edges: [{ from: "gw", to: "svc" }],
};

const invalidModelInput = {
  ...validModelInput,
  components: validModelInput.components.map((c) =>
    c.id === "svc" ? { ...c, hasCircuitBreaker: { ...c.hasCircuitBreaker, rationale: "" } } : c,
  ),
};

const validWorkloadParamsInput = {
  users: { included: true, tier: 100, target: 100 },
  requests: { included: false, tier: 1000, target: 1000 },
};

function toolUseResponse(toolName: string, input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: toolName, input }],
  } as unknown as Anthropic.Message;
}

function textOnlyResponse(): Anthropic.Message {
  return { content: [{ type: "text", text: "I have a question first." }] } as unknown as Anthropic.Message;
}

function toolNameOf(args: unknown): string {
  return (args as { tool_choice?: { name?: string } }).tool_choice?.name ?? "";
}

const emptyExtendedComponentsInput = { components: [], edges: [] };

/**
 * Routes by which tool is being called (`emit_system_model` vs
 * `emit_workload_parameters` vs `emit_extended_components`), since
 * fromProse now makes all three (the first two concurrently, the third
 * after). Each tool gets its own sequential queue of canned responses.
 */
function fakeClient(topologyResponses: Anthropic.Message[]): Anthropic {
  let topologyCall = 0;
  let workloadCall = 0;
  let extendedCall = 0;
  return {
    messages: {
      create: async (args: unknown) => {
        const tool = toolNameOf(args);
        if (tool === "emit_workload_parameters") {
          const response = workloadCall === 0 ? toolUseResponse("emit_workload_parameters", validWorkloadParamsInput) : undefined;
          workloadCall++;
          if (!response) throw new Error("fakeClient: no more canned workload-parameters responses");
          return response;
        }
        if (tool === "emit_extended_components") {
          const response = extendedCall === 0 ? toolUseResponse("emit_extended_components", emptyExtendedComponentsInput) : undefined;
          extendedCall++;
          if (!response) throw new Error("fakeClient: no more canned extended-components responses");
          return response;
        }
        const response = topologyResponses[topologyCall];
        topologyCall++;
        if (!response) throw new Error("fakeClient: no more canned topology responses");
        return response;
      },
    },
  } as unknown as Anthropic;
}

describe("fromProse", () => {
  it("returns a model unrepaired when the first attempt validates", async () => {
    const client = fakeClient([toolUseResponse("emit_system_model", validModelInput)]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(false);
    expect(result.model.id).toBe("toy");
    // The workload-parameters call's result is merged in alongside the topology.
    expect(result.model.workload.users?.tier).toBe(100);
  });

  it("repairs once when the first attempt fails validation", async () => {
    const client = fakeClient([
      toolUseResponse("emit_system_model", invalidModelInput),
      toolUseResponse("emit_system_model", validModelInput),
    ]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(true);
    expect(result.model.id).toBe("toy");
  });

  it("treats a response with no tool_use block as a failed attempt, not a crash", async () => {
    const client = fakeClient([textOnlyResponse(), toolUseResponse("emit_system_model", validModelInput)]);
    const result = await fromProse("a toy system", { client });

    expect(result.repaired).toBe(true);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([
      toolUseResponse("emit_system_model", invalidModelInput),
      toolUseResponse("emit_system_model", invalidModelInput),
    ]);

    await expect(fromProse("a toy system", { client })).rejects.toThrow(
      /still failed validation/i,
    );
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(fromProse("a toy system")).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("respects maxRetries: 0 by giving up after the first failure", async () => {
    const client = fakeClient([toolUseResponse("emit_system_model", invalidModelInput)]);
    await expect(
      fromProse("a toy system", { client, maxRetries: 0 }),
    ).rejects.toThrow(/after 0 repair attempt/i);
  });

  it("gives the repair attempt its own previous tool call to correct, not just an error string", async () => {
    // Discovered live (reworkModel, same shared retry loop): appending the
    // repair instruction as a second consecutive plain "user" message, with
    // no assistant turn showing what the model actually output before,
    // left it repairing blind — on a large input it reconstructed something
    // even MORE broken than the original rather than a precise fix. The fix
    // is Anthropic's own tool-result feedback pattern: an assistant turn
    // with the exact previous tool_use, then a user turn with a
    // `tool_result` block. This test inspects the actual second
    // `messages.create` call (for the topology tool specifically) to
    // confirm that shape, not just the outcome.
    const topologyCalls: unknown[] = [];
    const client = {
      messages: {
        create: async (args: unknown) => {
          const tool = toolNameOf(args);
          if (tool === "emit_workload_parameters") {
            return toolUseResponse("emit_workload_parameters", validWorkloadParamsInput);
          }
          if (tool === "emit_extended_components") {
            return toolUseResponse("emit_extended_components", emptyExtendedComponentsInput);
          }
          topologyCalls.push(args);
          return topologyCalls.length === 1
            ? toolUseResponse("emit_system_model", invalidModelInput)
            : toolUseResponse("emit_system_model", validModelInput);
        },
      },
    } as unknown as Anthropic;

    await fromProse("a toy system", { client });

    expect(topologyCalls).toHaveLength(2);
    const secondCallMessages = (topologyCalls[1] as { messages: Anthropic.MessageParam[] }).messages;

    // [user: original prose, assistant: the invalid tool_use, user: tool_result with the error]
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[0]!.role).toBe("user");

    const assistantTurn = secondCallMessages[1]!;
    expect(assistantTurn.role).toBe("assistant");
    const assistantContent = assistantTurn.content as Anthropic.ToolUseBlockParam[];
    expect(assistantContent[0]!.type).toBe("tool_use");
    expect(assistantContent[0]!.id).toBe("call_1"); // the id from the first (invalid) response
    expect(assistantContent[0]!.input).toEqual(invalidModelInput);

    const repairTurn = secondCallMessages[2]!;
    expect(repairTurn.role).toBe("user");
    const repairContent = repairTurn.content as Anthropic.ToolResultBlockParam[];
    expect(repairContent[0]!.type).toBe("tool_result");
    expect(repairContent[0]!.tool_use_id).toBe("call_1");
    expect(repairContent[0]!.is_error).toBe(true);
    expect(String(repairContent[0]!.content)).toMatch(/did not validate/i);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("asks for short rationales (output tokens are most of a build's cost)", () => {
    expect(SYSTEM_PROMPT).toMatch(/one short sentence \(roughly 8 to 15 words\)/);
  });

  // Regression test for a confirmed-live bug, not a style preference: naming
  // the exact banned rationale word ("placeholder") as the negative example
  // measurably primes the model to reproduce that literal word when it has
  // nothing specific to say (see schema.ts's STRUCTURAL_SELF_CHECK doc
  // comment). Only checking the distinctive ones — "none"/"unknown" are also
  // banned but too common as ordinary English to substring-check safely.
  it("never spells out a banned rationale word as an example", () => {
    const text = SYSTEM_PROMPT.toLowerCase();
    for (const word of ["placeholder", "lorem ipsum", "tbd", "n/a"]) {
      expect(text).not.toContain(word);
    }
  });
});
