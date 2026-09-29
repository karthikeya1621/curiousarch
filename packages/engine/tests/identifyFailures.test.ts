/**
 * `identifyFailures` against a fake Anthropic client — no network, no API
 * cost. Mirrors fromProse.test.ts's fake-client pattern: shares
 * `runStructuredCall`'s validate -> repair-retry -> give-up state machine.
 * This only proves the harness is wired correctly — not that the AI
 * produces good findings, which needs a live key.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { dropInstanceCountFindings, dropLargerScaleFindingsWhenSmall, dropMisattributedFindings, identifyFailures } from "../src/inference/identifyFailures.js";
import { checkout } from "../models/reference.js";

const validFindingsInput = {
  findings: [
    {
      code: "CASCADING_FAILURE_RISK",
      severity: "critical",
      componentId: "db",
      title: "No circuit breaker before the database",
      explanation: "If the database slows down, every request piles up waiting on it since nothing stops calls from reaching it.",
      fixes: [
        { id: "add-circuit-breaker", label: "Add a circuit breaker on the order service", tradeoff: "Failures surface as fast errors instead of hangs, which callers need to handle." },
      ],
      bitesAt: "now",
      aboutInstanceCount: false,
    },
  ],
};

const emptyFindingsInput = { findings: [] };

const invalidFindingsInput = {
  findings: [
    {
      code: "CASCADING_FAILURE_RISK",
      severity: "critical",
      componentId: "db",
      title: "No circuit breaker before the database",
      explanation: "",
      fixes: [],
      bitesAt: "now",
      aboutInstanceCount: false,
    },
  ],
};

function toolUseResponse(input: unknown): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "call_1", name: "emit_failures", input }],
  } as unknown as Anthropic.Message;
}

function fakeClient(responses: Anthropic.Message[]): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const response = responses[call];
        call++;
        if (!response) throw new Error("fakeClient: no more canned responses");
        return response;
      },
    },
  } as unknown as Anthropic;
}

describe("identifyFailures", () => {
  it("returns parsed findings when the response validates", async () => {
    const client = fakeClient([toolUseResponse(validFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("CASCADING_FAILURE_RISK");
    expect(findings[0]!.fixes).toHaveLength(1);
  });

  it("accepts an empty findings list — a healthy system reports nothing wrong", async () => {
    const client = fakeClient([toolUseResponse(emptyFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toEqual([]);
  });

  it("repairs once when a finding is missing its explanation/fixes", async () => {
    const client = fakeClient([toolUseResponse(invalidFindingsInput), toolUseResponse(validFindingsInput)]);
    const findings = await identifyFailures(checkout, { client });

    expect(findings).toHaveLength(1);
  });

  it("throws with the validation error after exhausting the repair retry", async () => {
    const client = fakeClient([toolUseResponse(invalidFindingsInput), toolUseResponse(invalidFindingsInput)]);

    await expect(identifyFailures(checkout, { client })).rejects.toThrow(/still failed validation/i);
  });

  it("requires an API key when no client is injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(identifyFailures(checkout)).rejects.toThrow(/API key/i);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe("instance counts are never findings — the AI flags them, code reads the flag", () => {
  const finding = (over: Record<string, unknown>) => ({
    code: "CASCADING_FAILURE_RISK",
    severity: "warning",
    componentId: "svc",
    title: "No circuit breaker",
    explanation: "Calls pile up.",
    fixes: [{ id: "f", label: "Do a thing", tradeoff: "Costs something." }],
    bitesAt: "now",
    aboutInstanceCount: false,
    ...over,
  });
  // svc: service, db: database, gw: gateway (from checkout) + an external dependency.
  const model = {
    components: [...checkout.components, { id: "stripe", kind: "external-dependency", label: "Stripe" }],
  } as never;
  const drop = (...findings: ReturnType<typeof finding>[]) => dropInstanceCountFindings(findings as never, model);

  it("keeps a finding the AI did not flag, whatever its wording", () => {
    const keep = finding({ title: "Single instance of the order service", code: "SINGLE_POINT_OF_FAILURE" });
    expect(drop(keep)).toEqual([keep]);
  });

  it("drops a finding the AI flagged as only about instance counts, on a kind that has one", () => {
    expect(drop(finding({ aboutInstanceCount: true }))).toEqual([]);
    expect(drop(finding({ aboutInstanceCount: true, componentId: "db" }))).toEqual([]);
  });

  it("only applies to kinds that HAVE an instance count: the same flag on an external dependency is a different risk and stays", () => {
    const keep = finding({ aboutInstanceCount: true, componentId: "stripe", title: "Payment provider is a single point of failure" });
    expect(drop(keep)).toEqual([keep]);
  });

  it("treats a finding saved before the field existed as not flagged", () => {
    const { aboutInstanceCount: _drop, ...legacy } = finding({});
    expect(drop(legacy as never)).toEqual([legacy]);
  });

  it("keeps everything else in a mixed list, in order", () => {
    const a = finding({ title: "A" });
    const b = finding({ aboutInstanceCount: true });
    const c = finding({ title: "C", componentId: "db" });
    expect(drop(a, b, c)).toEqual([a, c]);
  });

  it("identifyFailures applies it: a finding the model flags is filtered out, at no extra cost", async () => {
    const client = fakeClient([
      toolUseResponse({
        findings: [
          finding({ aboutInstanceCount: true, title: "Single instance" }),
          finding({ title: "No circuit breaker before the database", componentId: "db" }),
        ],
      }),
    ]);
    const findings = await identifyFailures(checkout, { client });
    expect(findings.map((f) => f.title)).toEqual(["No circuit breaker before the database"]);
  });

  it("the prompt says so plainly, defines both fields, and no longer offers the single-point-of-failure code as an example", async () => {
    let system = "";
    const client = {
      messages: {
        create: async (params: { system: { text: string }[] }) => {
          system = params.system.map((b) => b.text).join("");
          return toolUseResponse(emptyFindingsInput);
        },
      },
    } as unknown as Anthropic;
    await identifyFailures(checkout, { client });

    expect(system).toMatch(/Instance counts are not findings/);
    expect(system).toMatch(/aboutInstanceCount: true only when the entire concern/);
    expect(system).toMatch(/bitesAt: "now" if this hurts/);
    expect(system).not.toMatch(/SINGLE_POINT_OF_FAILURE/);
  });
});

describe("dropMisattributedFindings", () => {
  const model = {
    components: [
      { id: "gw", kind: "gateway" },
      { id: "lb", kind: "load-balancer" },
      { id: "pay", kind: "external-dependency" },
      { id: "svc", kind: "service" },
    ],
  };
  const f = (code: string, componentId: string) => ({ code, componentId, severity: "warning", title: "t", explanation: "e", fixes: [] });
  const keep = (...fs: ReturnType<typeof f>[]) => dropMisattributedFindings(fs as never, model as never).map((x) => x.code + ":" + x.componentId);

  it("drops a load-balancer finding raised on a gateway, and an external-dependency one raised on a service", () => {
    expect(keep(f("LB_NO_HEALTH_CHECKS", "gw"), f("EXTERNAL_DEPENDENCY_NO_FALLBACK", "svc"))).toEqual([]);
  });

  it("keeps them on the kind they are about, and leaves every other code alone", () => {
    expect(keep(f("LB_NO_HEALTH_CHECKS", "lb"), f("EXTERNAL_DEPENDENCY_NO_FALLBACK", "pay"), f("THUNDERING_HERD_RISK", "svc"))).toEqual([
      "LB_NO_HEALTH_CHECKS:lb",
      "EXTERNAL_DEPENDENCY_NO_FALLBACK:pay",
      "THUNDERING_HERD_RISK:svc",
    ]);
  });
});

describe("identifyFailures prompt", () => {
  it("asks for risks to be judged at the current scale, not a future one", async () => {
    let system = "";
    const client = {
      messages: {
        create: async (params: { system: unknown }) => {
          system = JSON.stringify(params.system);
          return { content: [{ type: "tool_use", id: "c", name: "emit_failures", input: { findings: [] } }] };
        },
      },
    } as unknown as Anthropic;
    await identifyFailures({ id: "m", name: "m", workload: {}, components: [], edges: [] } as never, { client });
    expect(system).toMatch(/Judge every risk at the system's CURRENT scale/);
  });
});

describe("dropLargerScaleFindingsWhenSmall — reads the AI's own bitesAt", () => {
  const f = (bitesAt?: string) => ({ code: "X", componentId: "q", severity: "warning", title: "t", explanation: "e", fixes: [], ...(bitesAt ? { bitesAt } : {}) }) as never;
  const kept = (workload: unknown, ...fs: unknown[]) => dropLargerScaleFindingsWhenSmall(fs as never, workload as never).map((x: { bitesAt?: string }) => x.bitesAt ?? "legacy");
  const small = { users: { included: true, tier: 100, target: 1_000_000 }, requests: { included: false, tier: 1000, target: 1000 } };

  it("at the lowest tier holds back findings the AI marked 'larger-scale', and keeps 'now' and legacy ones", () => {
    expect(kept(small, f("now"), f("larger-scale"), f())).toEqual(["now", "legacy"]);
  });

  it("keeps everything once any dimension in use is above the bottom rung, or none is in use", () => {
    expect(kept({ ...small, users: { included: true, tier: 10_000, target: 1_000_000 } }, f("larger-scale"))).toEqual(["larger-scale"]);
    expect(kept({}, f("larger-scale"))).toEqual(["larger-scale"]);
  });

  it("the wording of the code plays no part: an 'AT_SCALE' code the AI marked 'now' stays", () => {
    const named = { ...(f("now") as object), code: "FIXED_SCALING_AT_SCALE" } as never;
    expect(dropLargerScaleFindingsWhenSmall([named], small as never)).toEqual([named]);
  });
});

describe("identifyFailures tells the review what the tool already reports", () => {
  function capturingClient(response: Anthropic.Message): { client: Anthropic; users: string[] } {
    const users: string[] = [];
    const client = {
      messages: {
        create: async (req: { messages: { content: unknown }[] }) => {
          users.push(String(req.messages[0]?.content));
          return response;
        },
      },
    } as unknown as Anthropic;
    return { client, users };
  }

  // A broker nothing subscribes to: the graph itself reports it (BROKER_NO_SUBSCRIBER). Found live: the AI reported the
  // same dead-letter queue problem under its own code, and the user saw the one problem twice.
  const withDeadEndBroker = {
    ...checkout,
    components: [...checkout.components, { id: "dlq", kind: "message-broker", label: "Dead-Letter Queue" }],
    edges: [...checkout.edges, { from: "svc", to: "dlq" }],
  } as never;

  it("lists the structural findings under 'Already reported' so the AI does not restate them", async () => {
    const { client, users } = capturingClient(toolUseResponse(emptyFindingsInput));
    const found = await identifyFailures(withDeadEndBroker, { client });
    expect(users[0]).toContain("Already reported:");
    expect(users[0]).toContain("- dlq: Dead-Letter Queue has no subscribers");
    // and the tool's own finding is still shown, once
    expect(found.filter((f) => f.componentId === "dlq")).toHaveLength(1);
  });

  it("adds no such section when the graph has nothing structural to report", async () => {
    const { client, users } = capturingClient(toolUseResponse(emptyFindingsInput));
    await identifyFailures(checkout, { client });
    expect(users[0]).not.toContain("Already reported");
  });

  it("the prompt says a differently worded restatement is still a duplicate", async () => {
    let system = "";
    const client = {
      messages: {
        create: async (params: { system: unknown }) => {
          system = JSON.stringify(params.system);
          return toolUseResponse(emptyFindingsInput);
        },
      },
    } as unknown as Anthropic;
    await identifyFailures(checkout, { client });
    expect(system).toMatch(/Already reported/);
    expect(system).toMatch(/same problem in other words/);
  });
});
