/**
 * `identifyFailures` against a fake Anthropic client — no network, no API
 * cost. Mirrors fromProse.test.ts's fake-client pattern: shares
 * `runStructuredCall`'s validate -> repair-retry -> give-up state machine.
 * This only proves the harness is wired correctly — not that the AI
 * produces good findings, which needs a live key.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { dropInstanceCountFindings, dropMisattributedFindings, identifyFailures } from "../src/inference/identifyFailures.js";
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

describe("instance counts are never findings", () => {
  const finding = (over: Record<string, unknown>) => ({
    code: "CASCADING_FAILURE_RISK",
    severity: "warning" as const,
    componentId: "svc",
    title: "No circuit breaker",
    explanation: "Calls pile up.",
    fixes: [{ id: "f", label: "Do a thing", tradeoff: "Costs something." }],
    ...over,
  });
  // svc: service, db: database, gw: gateway (from checkout) + an external dependency.
  const model = {
    components: [
      ...checkout.components,
      { id: "stripe", kind: "external-dependency", label: "Stripe" },
    ],
  } as never;
  const drop = (...findings: ReturnType<typeof finding>[]) => dropInstanceCountFindings(findings as never, model);

  it("keeps a finding about anything else", () => {
    const keep = finding({});
    expect(drop(keep)).toEqual([keep]);
  });

  it.each([
    ["the classic code", { code: "SINGLE_POINT_OF_FAILURE", title: "Order service is a problem" }],
    ["an invented instance code", { code: "SINGLE_INSTANCE_SERVICE", title: "Something" }],
    ["a replica code", { code: "DATABASE_NO_REPLICAS", componentId: "db", title: "Database" }],
    ["a title saying single instance", { code: "AVAILABILITY_RISK", title: "Single instance of the order service" }],
    ["a title saying it needs more instances", { code: "CAPACITY_RISK", title: "Order service needs more instances" }],
    ["a title saying no replicas", { code: "DATA_LOSS_RISK", componentId: "db", title: "Primary database has no replicas" }],
    ["a title calling it a single point of failure", { code: "AVAILABILITY_RISK", title: "Order service is a single point of failure" }],
  ])("drops %s", (_label, over) => {
    expect(drop(finding(over))).toEqual([]);
  });

  it("matches on code and title only — an explanation that mentions instances in passing is a finding about something else", () => {
    const keep = finding({ explanation: "With a single instance, one slow call blocks everything, so a circuit breaker matters." });
    expect(drop(keep)).toEqual([keep]);
  });

  it("only applies to kinds that HAVE an instance count: a single point of failure on an external dependency is a different risk and stays", () => {
    const keep = finding({
      code: "SINGLE_POINT_OF_FAILURE",
      componentId: "stripe",
      title: "Payment provider is a single point of failure",
    });
    expect(drop(keep)).toEqual([keep]);
  });

  it("keeps everything else in a mixed list, in order", () => {
    const a = finding({ title: "A" });
    const b = finding({ code: "SINGLE_POINT_OF_FAILURE" });
    const c = finding({ title: "C", componentId: "db" });
    expect(drop(a, b, c)).toEqual([a, c]);
  });

  it("identifyFailures applies it: a model that reports one anyway gets it filtered out, at no extra cost", async () => {
    const client = fakeClient([
      toolUseResponse({
        findings: [
          finding({ code: "SINGLE_POINT_OF_FAILURE", title: "Single instance" }),
          finding({ title: "No circuit breaker before the database", componentId: "db" }),
        ],
      }),
    ]);
    const findings = await identifyFailures(checkout, { client });
    expect(findings.map((f) => f.title)).toEqual(["No circuit breaker before the database"]);
  });

  it("the prompt says so plainly — and no longer offers the single-point-of-failure code as an example to reach for", async () => {
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
